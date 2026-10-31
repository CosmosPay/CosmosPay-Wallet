/**
 * Paying ADA on Cardano: a Conway-era transaction the wallet builds, signs and serializes itself
 * from its own UTXOs — the coin only, from the payment key of `lib/addresses/cardano.ts`
 * (m/1852'/1815'/0'/0/0), change back to the same base address.
 *
 *   body     { 0: inputs (tag 258), 1: [[address, coin], …], 2: fee, 3: ttl, 15: network id }
 *   witness  { 0: (tag 258) [[vkey, signature]] }
 *   tx       [body, witness set, true, null]
 *   id       blake2b-256(body), which is also what the key signs
 *
 * What keeps a public service from deciding anything (`lib/send/types.ts`):
 *  - The network is checked twice before anything is signed: Koios' node must answer the mode's
 *    genesis magic, and the Yoroi backend that lists the UTXOs must know the mode's first Shelley
 *    block (`constants/cardanoSend.ts`). The body states its network id (field 15), and its
 *    inputs exist on one ledger only, so the signature is bound to that network either way.
 *  - The fee is what the protocol parameters price this exact transaction at, and never more
 *    than `maxFee`; a node inflating the parameters is refused ('fee'), not paid.
 *  - Every amount is a bigint of lovelace from the API's digit strings to the CBOR integer.
 *  - Each signature is checked with `ed25519.verify` before the transaction leaves the device.
 *
 * The services are Koios' Ogmios pass-through (genesis, tip, protocol parameters, submission)
 * and EMURGO's Yoroi backend (UTXOs, balance): Koios' REST endpoints answer a browser without
 * CORS headers, so a page cannot read them (see `constants/cardanoSend.ts`).
 */
import { base58, bech32 } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, numberToBytesLE } from '@noble/curves/utils.js';
import type { ChainNet } from '@/constants/chains';
import {
  CARDANO_ADDRESS_HRP,
  CARDANO_BYRON_MAGIC,
  CARDANO_ENDPOINTS,
  CARDANO_NETWORK_ID,
  CARDANO_NETWORK_MAGIC,
  CARDANO_REFERENCE_BLOCK,
  CARDANO_REQUEST_TIMEOUT_MS,
  CARDANO_TTL_SLOTS,
  CARDANO_UTXO_OVERHEAD_BYTES,
} from '@/constants/cardanoSend';
import type { NetworkId } from '@/constants/networks';
import { CARDANO_PAYMENT_PATH } from '@/lib/addresses/cardano';
import { ApiShapeError, arrayOf, object, parseShape, str, unchecked, type Check } from '@/lib/apiShape';
import { ChainSwapRefused } from '@/lib/chainSwap';
import { CBOR_NULL, CBOR_TRUE, cborArray, cborBytes, cborDecode, cborMap, cborTag, cborUint, type CborItem } from '@/lib/send/cbor';
import type { FamilyTransfer } from '@/lib/send/types';

/* ------------------------------ the payment key ------------------------------ */

/*
 * The private side of `lib/addresses/cardano.ts`, which keeps its derivation to itself (it only
 * answers addresses). The Icarus root and the V2 child step below are that file's, duplicated on
 * purpose and pinned by the tests to the address it derives: exporting them from there would be
 * the one-line way to drop this copy.
 */

const HARDENED = 0x80000000;
const L = ed25519.Point.Fn.ORDER;

/** The Icarus root (CIP-3): kL ‖ kR ‖ chain code from the phrase's ENTROPY, kL clamped. */
function icarusRoot(entropy: Uint8Array): Uint8Array {
  const xprv = pbkdf2(sha512, new Uint8Array(0), entropy, { c: 4096, dkLen: 96 });
  xprv[0] &= 0b1111_1000;
  xprv[31] &= 0b0001_1111;
  xprv[31] |= 0b0100_0000;
  return xprv;
}

/** kL · B: the extended key's scalar is used as it is, never hashed like an ed25519 seed. */
function publicKeyOf(kL: Uint8Array): Uint8Array {
  return ed25519.Point.BASE.multiply(bytesToNumberLE(kL) % L).toBytes();
}

/** BIP32-Ed25519 child (derivation scheme V2): kL' = kL + 8·ZL[0..28), kR' = kR + ZR, little-endian. */
function deriveChild(xprv: Uint8Array, index: number): Uint8Array {
  const kL = xprv.subarray(0, 32);
  const kR = xprv.subarray(32, 64);
  const chainCode = xprv.subarray(64, 96);
  const i = new Uint8Array(4);
  new DataView(i.buffer).setUint32(0, index, true);
  const [zTag, cTag, body] = index >= HARDENED ? [0x00, 0x01, concatBytes(kL, kR)] : [0x02, 0x03, publicKeyOf(kL)];
  const z = hmac(sha512, chainCode, concatBytes(Uint8Array.of(zTag), body, i));
  const c = hmac(sha512, chainCode, concatBytes(Uint8Array.of(cTag), body, i));
  const child = new Uint8Array(96);
  let carry = 0;
  for (let b = 0; b < 32; b++) {
    const r = kL[b] + (b < 28 ? z[b] << 3 : 0) + carry;
    child[b] = r & 0xff;
    carry = r >> 8;
  }
  carry = 0;
  for (let b = 0; b < 32; b++) {
    const r = kR[b] + z[32 + b] + carry;
    child[32 + b] = r & 0xff;
    carry = r >> 8;
  }
  child.set(c.subarray(32, 64), 64);
  body.fill(0);
  z.fill(0);
  c.fill(0);
  return child;
}

/**
 * The 64-byte extended key kL ‖ kR of the wallet's payment key (m/1852'/1815'/0'/0/0) for a
 * phrase's BIP-39 entropy: the `secret` `sendCardano` signs with. The chain code is dropped —
 * signing never needs it — and every intermediate key is zeroed.
 */
export function cardanoPaymentSecret(entropy: Uint8Array): Uint8Array {
  let key = icarusRoot(entropy);
  for (const index of CARDANO_PAYMENT_PATH) {
    const next = deriveChild(key, index);
    key.fill(0);
    key = next;
  }
  const secret = key.slice(0, 64);
  key.fill(0);
  return secret;
}

/** The payment key's public key (the `vkey` of a witness) for an extended secret kL ‖ kR. */
export function cardanoPublicKey(secret: Uint8Array): Uint8Array {
  if (secret.length !== 64) throw new Error('A Cardano payment secret is 64 bytes (kL ‖ kR)');
  return publicKeyOf(secret.subarray(0, 32));
}

/**
 * BIP32-Ed25519 signing with an extended key, which has no seed to hash: RFC 8032's equations
 * with kL as the scalar and kR as the nonce prefix —
 *   r = SHA-512(kR ‖ M) mod L,  R = r·B,  A = kL·B,  S = (r + SHA-512(R ‖ A ‖ M) · kL) mod L.
 * For a key expanded from an ed25519 seed this IS RFC 8032's signature (the tests hold it to the
 * RFC's vector), and any ed25519 verifier checks it against A.
 */
export function cardanoSign(secret: Uint8Array, message: Uint8Array): Uint8Array {
  if (secret.length !== 64) throw new Error('A Cardano payment secret is 64 bytes (kL ‖ kR)');
  const kL = bytesToNumberLE(secret.subarray(0, 32)) % L;
  const nonce = sha512(concatBytes(secret.subarray(32, 64), message));
  const r = bytesToNumberLE(nonce) % L;
  nonce.fill(0);
  const R = ed25519.Point.BASE.multiply(r).toBytes();
  const A = ed25519.Point.BASE.multiply(kL).toBytes();
  const h = bytesToNumberLE(sha512(concatBytes(R, A, message))) % L;
  const S = (r + h * kL) % L;
  return concatBytes(R, numberToBytesLE(S, 32));
}

/* -------------------------------- addresses --------------------------------- */

/** An address as an output carries it, and the key hash that pays from it (Shelley key addresses). */
interface CardanoAddress {
  bytes: Uint8Array;
  /** blake2b-224 of the payment key; null for a Byron address. */
  keyHash: Uint8Array | null;
}

/** Longer than any Byron or Shelley address; base58 decoding is quadratic, so bound it first. */
const MAX_ADDRESS_CHARS = 200;

/**
 * A Shelley address the wallet pays to (CIP-19): a base address whose payment part is a key
 * (header types 0 and 2, 57 bytes) or an enterprise key address (type 6, 29 bytes), on the mode's
 * network — its prefix and its header's network id both. Refused:
 *  - a script payment part (types 1, 3, 7): a plain transfer carries no datum, and ADA sent
 *    without one to a Plutus V1/V2 script is locked for good; the address alone cannot tell such
 *    a script from a multisig one, so neither is offered;
 *  - pointer addresses (4, 5): retired in Conway, and nothing hands one out any more;
 *  - reward addresses (14, 15, `stake1…`): they hold rewards, they never receive a payment.
 */
function shelleyAddress(address: string, env: ChainNet): CardanoAddress | null {
  let decoded: { prefix: string; bytes: Uint8Array };
  try {
    decoded = bech32.decodeToBytes(address, false);
  } catch {
    return null;
  }
  const { prefix, bytes } = decoded;
  if (prefix !== CARDANO_ADDRESS_HRP[env] || bytes.length === 0) return null;
  const type = bytes[0] >> 4;
  if ((bytes[0] & 0x0f) !== CARDANO_NETWORK_ID[env]) return null;
  const size = type === 0 || type === 2 ? 57 : type === 6 ? 29 : 0;
  if (bytes.length !== size) return null;
  return { bytes, keyHash: bytes.slice(1, 29) };
}

/** CRC-32 (IEEE 802.3), the checksum a Byron address carries over its payload. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const uintOf = (item: CborItem | undefined): bigint | null => (item?.type === 'uint' ? item.value : null);

/**
 * A Byron address (`Ae2…`, `DdzFF…`), validated in full rather than guessed at: base58 of
 * `[#6.24(bytes .cbor [root, attributes, type]), crc32]`, the CRC over the tagged bytes, a
 * 28-byte root, a public-key type (0 — never a script or an AVVM redemption address), and only
 * the two attributes Byron defines: 1, the encrypted derivation path, and 2, the protocol magic,
 * which a mainnet address leaves out and a test network's names. Byron outputs are still valid
 * in Conway; a typo fails the CRC.
 */
function byronAddress(address: string, env: ChainNet): CardanoAddress | null {
  let raw: Uint8Array;
  let top: CborItem;
  try {
    raw = base58.decode(address);
    top = cborDecode(raw);
  } catch {
    return null;
  }
  if (top.type !== 'array' || top.items.length !== 2) return null;
  const [tagged, crc] = top.items;
  if (tagged.type !== 'tag' || tagged.tag !== 24n || tagged.item.type !== 'bytes') return null;
  const payload = tagged.item.value;
  if (uintOf(crc) !== BigInt(crc32(payload))) return null;
  let inner: CborItem;
  try {
    inner = cborDecode(payload);
  } catch {
    return null;
  }
  if (inner.type !== 'array' || inner.items.length !== 3) return null;
  const [root, attributes, type] = inner.items;
  if (root.type !== 'bytes' || root.value.length !== 28 || uintOf(type) !== 0n || attributes.type !== 'map') return null;
  let magic: bigint | null = null;
  const seen = new Set<bigint>();
  for (const [key, value] of attributes.entries) {
    const k = uintOf(key);
    if ((k !== 1n && k !== 2n) || seen.has(k) || value.type !== 'bytes') return null;
    seen.add(k);
    if (k === 2n) {
      try {
        magic = uintOf(cborDecode(value.value));
      } catch {
        return null;
      }
      if (magic === null) return null;
    }
  }
  const expected = CARDANO_BYRON_MAGIC[env];
  if (expected === null ? magic !== null : magic !== BigInt(expected)) return null;
  return { bytes: raw, keyHash: null };
}

function cardanoAddress(address: string, env: ChainNet): CardanoAddress | null {
  if (typeof address !== 'string' || address.length === 0 || address.length > MAX_ADDRESS_CHARS) return null;
  return shelleyAddress(address, env) ?? byronAddress(address, env);
}

/** Whether `address` is one the wallet pays ADA to on `network` in `env` — the screen and the signer share it. */
export function isCardanoAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  return network === 'cardano' && cardanoAddress(address, env) !== null;
}

/** Whether `secret`'s payment key is the one `address` pays from (its payment key hash). */
export function cardanoKeyControls(secret: Uint8Array, address: string, env: ChainNet): boolean {
  const parsed = shelleyAddress(address, env);
  if (!parsed?.keyHash) return false;
  const hash = blake2b(cardanoPublicKey(secret), { dkLen: 28 });
  return bytesToHex(hash) === bytesToHex(parsed.keyHash);
}

// The test network's spelling of an address lives with the address derivation, which the main
// bundle loads; this sender re-exports it for its own tests and callers.
export { cardanoTestnetAddress } from '@/lib/addresses/cardano';

/* ------------------------------- the transaction ------------------------------ */

/** A UTXO holding ADA alone, as the transaction spends it. */
export interface CardanoUtxo {
  /** The producing transaction's id, 64 hex characters. */
  txHash: string;
  index: number;
  lovelace: bigint;
}

/** The protocol parameters a transfer is priced with (Ogmios `queryLedgerState/protocolParameters`). */
export interface CardanoParams {
  /** `min_fee_a`: lovelace per byte of the whole transaction. */
  minFeeA: bigint;
  /** `min_fee_b`: lovelace per transaction. */
  minFeeB: bigint;
  /** `coins_per_utxo_byte`: what each byte of an output costs it in minimum ADA. */
  coinsPerUtxoByte: bigint;
  /** The largest transaction the ledger takes, in bytes. */
  maxTxSize: number;
}

export interface CardanoTransferInput {
  /** ADA-only UTXOs of the sending address. */
  utxos: readonly CardanoUtxo[];
  params: CardanoParams;
  /** The recipient's address bytes. */
  to: Uint8Array;
  /** Our own address bytes, where the change goes. */
  changeTo: Uint8Array;
  amount: bigint;
  /** The last slot the transaction is valid in. */
  ttl: bigint;
  /** `CARDANO_NETWORK_ID` of the mode. */
  networkId: number;
}

export interface CardanoTransferPlan {
  body: Uint8Array;
  /** blake2b-256 of `body`: what is signed. */
  bodyHash: Uint8Array;
  /** The transaction id: `bodyHash` in hex. */
  txId: string;
  fee: bigint;
  /** Back to our address; 0 when there is no change output. */
  change: bigint;
  inputs: CardanoUtxo[];
  /** The signed transaction's size in bytes, which the fee prices. */
  size: number;
}

/** An output in the legacy array form, `[address, coin]` — the smallest, so the cheapest. */
export function cardanoOutput(address: Uint8Array, lovelace: bigint): Uint8Array {
  return cborArray([cborBytes(address), cborUint(lovelace)]);
}

/** The least ADA an output must hold (Babbage onwards): coins per byte × (160 + its size). */
export function cardanoMinUtxo(output: Uint8Array, coinsPerUtxoByte: bigint): bigint {
  return coinsPerUtxoByte * (CARDANO_UTXO_OVERHEAD_BYTES + BigInt(output.length));
}

/** The least fee a transaction of `size` bytes pays: min_fee_a × size + min_fee_b (no scripts here). */
export function cardanoMinFee(size: number, params: CardanoParams): bigint {
  return params.minFeeA * BigInt(size) + params.minFeeB;
}

/** Inputs sorted by id then index — the ledger's own order for the set, so the bytes are deterministic. */
function sortInputs(inputs: readonly CardanoUtxo[]): CardanoUtxo[] {
  return [...inputs].sort((a, b) => (a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index));
}

/** The body map, keys ascending. Sets carry tag 258: Conway takes it, and the next era requires it. */
export function cardanoBody(inputs: readonly CardanoUtxo[], outputs: readonly Uint8Array[], fee: bigint, ttl: bigint, networkId: number): Uint8Array {
  const encodedInputs = sortInputs(inputs).map((u) => cborArray([cborBytes(hexToBytes(u.txHash)), cborUint(u.index)]));
  return cborMap([
    [cborUint(0), cborTag(258, cborArray(encodedInputs))],
    [cborUint(1), cborArray(outputs)],
    [cborUint(2), cborUint(fee)],
    [cborUint(3), cborUint(ttl)],
    [cborUint(15), cborUint(networkId)],
  ]);
}

/** The signed transaction: [body, { 0: #6.258([[vkey, signature]]) }, valid, no metadata]. */
export function cardanoSignedTx(body: Uint8Array, vkey: Uint8Array, signature: Uint8Array): Uint8Array {
  const witness = cborArray([cborBytes(vkey), cborBytes(signature)]);
  const witnesses = cborMap([[cborUint(0), cborTag(258, cborArray([witness]))]]);
  return cborArray([body, witnesses, CBOR_TRUE, CBOR_NULL]);
}

/** A witness is a 32-byte key and a 64-byte signature whatever they hold: sizing needs neither. */
const PLACEHOLDER_VKEY = new Uint8Array(32);
const PLACEHOLDER_SIGNATURE = new Uint8Array(64);
/** Fee rounds before giving up; a fee settles in two or three (only integer widths move it). */
const FEE_ROUNDS = 8;
/** The smallest an encoded input can be: array head, bytes head, 32-byte id, one-byte index. */
const MIN_INPUT_BYTES = 36;

interface Attempt {
  body: Uint8Array;
  fee: bigint;
  change: bigint;
  size: number;
  /** What the fee pays above the network's price: change too small to be an output of its own. */
  dust: bigint;
}

/**
 * The transaction `inputs` make, or null when they cannot pay the amount and its fee. The fee
 * is priced on the transaction it is in, so it is found by iteration: price the transaction,
 * put that fee in, price again, until the fee covers its own transaction. Change below the
 * minimum an output must hold cannot be returned, so it goes to the fee instead (`dust`).
 */
function attempt(inputs: readonly CardanoUtxo[], recipient: Uint8Array, p: CardanoTransferInput): Attempt | null {
  const total = inputs.reduce((s, u) => s + u.lovelace, 0n);
  let fee = 0n;
  for (let round = 0; round < FEE_ROUNDS; round++) {
    const rest = total - p.amount - fee;
    if (rest < 0n) return null;
    const changeOutput = rest > 0n ? cardanoOutput(p.changeTo, rest) : null;
    const keep = changeOutput !== null && rest >= cardanoMinUtxo(changeOutput, p.params.coinsPerUtxoByte);
    const outputs = keep && changeOutput ? [recipient, changeOutput] : [recipient];
    const paid = keep ? fee : total - p.amount;
    const body = cardanoBody(inputs, outputs, paid, p.ttl, p.networkId);
    const size = cardanoSignedTx(body, PLACEHOLDER_VKEY, PLACEHOLDER_SIGNATURE).length;
    const need = cardanoMinFee(size, p.params);
    if (paid >= need) return { body, fee: paid, change: keep ? rest : 0n, size, dust: keep ? 0n : paid - need };
    // Without a change output everything left over is already the fee; short of it is short.
    if (!keep) return null;
    fee = need;
  }
  return null;
}

/**
 * The transfer of `amount` to `to` from `utxos`: largest UTXO first (fewest inputs, smallest
 * fee), stopping at the first selection that returns its change or has none, and taking one
 * more input rather than burning a too-small change when there is one to take. Refuses
 * 'minimum' when the recipient's output would hold less than the ledger's minimum, and 'funds'
 * when the UTXOs — within one transaction's size — cannot pay the amount and the fee.
 */
export function planCardanoTransfer(p: CardanoTransferInput): CardanoTransferPlan {
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  const recipient = cardanoOutput(p.to, p.amount);
  if (p.amount < cardanoMinUtxo(recipient, p.params.coinsPerUtxoByte)) throw new ChainSwapRefused('minimum');
  const ordered = [...p.utxos].sort((a, b) =>
    a.lovelace !== b.lovelace ? (a.lovelace > b.lovelace ? -1 : 1) : a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index,
  );
  const chosen: CardanoUtxo[] = [];
  let found: { attempt: Attempt; inputs: CardanoUtxo[] } | null = null;
  let fallback: { attempt: Attempt; inputs: CardanoUtxo[] } | null = null;
  for (const utxo of ordered) {
    chosen.push(utxo);
    // An input is at least 36 bytes ([32-byte id, index]): past this many none can fit, and an
    // address holding thousands of dust UTXOs must not cost thousands of attempts to find out.
    if (chosen.length * MIN_INPUT_BYTES > p.params.maxTxSize) break;
    const a = attempt(chosen, recipient, p);
    if (!a) continue;
    // Every further input only makes it larger.
    if (a.size > p.params.maxTxSize) break;
    if (a.dust === 0n) {
      found = { attempt: a, inputs: [...chosen] };
      break;
    }
    fallback ??= { attempt: a, inputs: [...chosen] };
  }
  const plan = found ?? fallback;
  if (!plan) throw new ChainSwapRefused('funds');
  const { body, fee, change, size } = plan.attempt;
  const spent = plan.inputs.reduce((s, u) => s + u.lovelace, 0n);
  // The ledger's own rule (value conserved), checked here so a slip is an error, never a loss.
  if (spent !== p.amount + change + fee) throw new Error('Cardano transfer does not balance');
  const bodyHash = blake2b(body, { dkLen: 32 });
  return { body, bodyHash, txId: bytesToHex(bodyHash), fee, change, inputs: sortInputs(plan.inputs), size };
}

/* -------------------------------- the services -------------------------------- */

interface Answer {
  status: number;
  json: unknown;
}

/**
 * One JSON request, bounded by `CARDANO_REQUEST_TIMEOUT_MS`. It carries the address and nothing
 * else about the person: no credentials, no referrer. Errors name the service, never the URL's
 * or the body's address.
 */
async function request(url: string, body: unknown, label: string): Promise<Answer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CARDANO_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new Error(`Cardano ${label}: rate limited`);
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      throw new Error(`Cardano ${label}: HTTP ${res.status}, not JSON`);
    }
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`Cardano ${label}: timed out`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * `object()` checks the declared fields and answers the source object unchanged, so these checks
 * only validate; each value becomes a bigint where it is read.
 */

/** A JSON number the source must have written as a safe non-negative integer (none read here is near 2^53). */
const int: Check<number> = (v, path, url) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ApiShapeError(url, path, 'a non-negative integer', v);
  return v;
};

/** A lovelace amount the Yoroi backend writes as a digit string, so no float ever holds it. */
const digits: Check<string> = (v, path, url) => {
  if (typeof v !== 'string' || !/^\d{1,20}$/.test(v)) throw new ApiShapeError(url, path, 'an unsigned integer string', v);
  return v;
};

const txHash: Check<string> = (v, path, url) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new ApiShapeError(url, path, 'a transaction id', v);
  return v;
};

/** One Ogmios (v6) call through Koios. A JSON-RPC error is thrown with its code only. */
async function ogmios(url: string, method: string, params?: unknown): Promise<unknown> {
  const { status, json } = await request(url, params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }, method);
  const envelope = parseShape(`ogmios ${method}`, object({}), json) as { result?: unknown; error?: { code?: unknown } };
  if (envelope.error !== undefined) {
    const code = typeof envelope.error?.code === 'number' ? envelope.error.code : 'unknown';
    throw new Error(`Cardano node refused ${method} (code ${code})`);
  }
  if (status !== 200 || envelope.result === undefined) throw new Error(`Cardano ${method}: HTTP ${status}`);
  return envelope.result;
}

async function networkMagic(url: string): Promise<bigint> {
  const result = await ogmios(url, 'queryNetwork/genesisConfiguration', { era: 'shelley' });
  return BigInt(parseShape('ogmios genesisConfiguration', object({ networkMagic: int }), result).networkMagic);
}

async function tipSlot(url: string): Promise<bigint> {
  // A node still at the origin answers the string "origin": no slot, nothing to sign against.
  return BigInt(parseShape('ogmios tip', object({ slot: int }), await ogmios(url, 'queryNetwork/tip')).slot);
}

async function protocolParams(url: string): Promise<CardanoParams> {
  const result = await ogmios(url, 'queryLedgerState/protocolParameters');
  const shape = object({
    minFeeCoefficient: int,
    minFeeConstant: object({ ada: object({ lovelace: int }) }),
    minUtxoDepositCoefficient: int,
    maxTransactionSize: object({ bytes: int }),
  });
  const pp = parseShape('ogmios protocolParameters', shape, result);
  return {
    minFeeA: BigInt(pp.minFeeCoefficient),
    minFeeB: BigInt(pp.minFeeConstant.ada.lovelace),
    coinsPerUtxoByte: BigInt(pp.minUtxoDepositCoefficient),
    maxTxSize: pp.maxTransactionSize.bytes,
  };
}

/** Whether the Yoroi backend's chain holds `block` (`v2/tipStatus` with it as the reference point). */
async function yoroiHolds(api: string, block: string): Promise<boolean> {
  const { status, json } = await request(`${api}/v2/tipStatus`, { reference: { bestBlocks: [block] } }, 'tipStatus');
  const error = (json as { error?: { response?: unknown } } | null)?.error;
  if (error?.response === 'REFERENCE_POINT_BLOCK_NOT_FOUND') return false;
  if (status !== 200) throw new Error(`Cardano tipStatus: HTTP ${status}`);
  const found = parseShape('yoroi tipStatus', object({ reference: object({ lastFoundBestBlock: str }) }), json);
  return found.reference.lastFoundBestBlock === block;
}

/** Everything the Yoroi backend lists at `address`; every entry must be at that address. */
async function utxosAt(api: string, address: string): Promise<{ spendable: CardanoUtxo[]; count: number }> {
  const { status, json } = await request(`${api}/txs/utxoForAddresses`, { addresses: [address] }, 'utxoForAddresses');
  if (status !== 200) throw new Error(`Cardano utxoForAddresses: HTTP ${status}`);
  const shape = arrayOf(
    object({
      tx_hash: txHash,
      tx_index: int,
      receiver: str,
      amount: digits,
      assets: arrayOf(unchecked),
    }),
  );
  const rows = parseShape('yoroi utxoForAddresses', shape, json) as {
    tx_hash: string;
    tx_index: number;
    receiver: string;
    amount: string;
    assets: unknown[];
    script_ref?: unknown;
  }[];
  const spendable: CardanoUtxo[] = [];
  for (const row of rows) {
    if (row.receiver !== address) throw new Error('Cardano utxoForAddresses answered another address');
    // Only UTXOs holding ADA alone are spent. One carrying native tokens would have to return
    // them in an output of its own, and this transfer pays the coin only; one carrying a
    // reference script would add a reference-script fee this transfer does not price. Both stay
    // where they are, so a balance that counts their ADA can be more than one send reaches.
    if (row.assets.length > 0 || (row.script_ref !== undefined && row.script_ref !== null)) continue;
    spendable.push({ txHash: row.tx_hash, index: Number(row.tx_index), lovelace: BigInt(row.amount) });
  }
  return { spendable, count: rows.length };
}

/**
 * Lovelace held at `address` in `env`: every UTXO's ADA, including the ADA that rides along with
 * native tokens (which `sendCardano` leaves unspent). Throws when it cannot be read — the
 * caller's "unknown", never a zero.
 */
export async function readCardanoBalance(env: ChainNet, address: string): Promise<bigint> {
  if (!cardanoAddress(address, env)) throw new Error('Not a Cardano address of this network');
  const { status, json } = await request(`${CARDANO_ENDPOINTS[env].yoroi}/txs/utxoSumForAddresses`, { addresses: [address] }, 'utxoSumForAddresses');
  if (status !== 200) throw new Error(`Cardano utxoSumForAddresses: HTTP ${status}`);
  return BigInt(parseShape('yoroi utxoSumForAddresses', object({ sum: digits }), json).sum);
}

/* -------------------------------- the transfer --------------------------------- */

/**
 * Refuses 'chain' unless both services serve `env`'s network: Koios' node answers its genesis
 * magic, and the Yoroi backend holds its first Shelley block. Asked before anything is read from
 * them that a signature would depend on.
 */
export async function assertCardanoNetwork(env: ChainNet): Promise<void> {
  const { ogmios: node, yoroi } = CARDANO_ENDPOINTS[env];
  const [magic, holds] = await Promise.all([networkMagic(node), yoroiHolds(yoroi, CARDANO_REFERENCE_BLOCK[env])]);
  if (magic !== BigInt(CARDANO_NETWORK_MAGIC[env]) || !holds) throw new ChainSwapRefused('chain');
}

/**
 * Everything `sendCardano` does short of submitting: the checks, the reads, the transaction
 * built, priced, signed and verified. Answers the signed transaction and its id. Split out so a
 * main-network dry run can never broadcast.
 */
export async function prepareCardanoTransfer(p: FamilyTransfer): Promise<{ tx: Uint8Array; txId: string; fee: bigint }> {
  const env = p.env;
  if (p.network !== 'cardano' || p.def.id !== 'cardano') throw new ChainSwapRefused('chain');
  // The coin only: a native token would need a multi-asset value, and the registry lists none here.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  // A memo would be transaction metadata (CIP-20), which this transfer does not write: refused
  // rather than silently dropped.
  if (p.memo !== undefined && p.memo !== '') throw new ChainSwapRefused('memo');
  const recipient = cardanoAddress(p.to, env);
  if (!recipient) throw new ChainSwapRefused('address');
  const owner = shelleyAddress(p.owner, env);
  if (!owner) throw new Error('The sending address is not a Cardano address of this network');
  if (!cardanoKeyControls(p.secret, p.owner, env)) throw new Error('The Cardano key does not control the sending address');

  await assertCardanoNetwork(env);
  const { ogmios: node, yoroi } = CARDANO_ENDPOINTS[env];
  const [params, slot, utxos] = await Promise.all([protocolParams(node), tipSlot(node), utxosAt(yoroi, p.owner)]);
  // Nothing at the address at all: it has never received anything (or has spent it all).
  if (utxos.count === 0) throw new ChainSwapRefused('unfunded');
  const plan = planCardanoTransfer({
    utxos: utxos.spendable,
    params,
    to: recipient.bytes,
    changeTo: owner.bytes,
    amount: p.amount,
    ttl: slot + BigInt(CARDANO_TTL_SLOTS),
    networkId: CARDANO_NETWORK_ID[env],
  });
  // The parameters are the node's word: whatever it says, one send never costs more than this.
  if (plan.fee > p.maxFee) throw new ChainSwapRefused('fee');

  const vkey = cardanoPublicKey(p.secret);
  const signature = cardanoSign(p.secret, plan.bodyHash);
  if (!ed25519.verify(signature, plan.bodyHash, vkey)) throw new Error('The Cardano signature does not verify');
  const tx = cardanoSignedTx(plan.body, vkey, signature);
  // The fee was priced on a placeholder witness of the same widths; a different size would underpay.
  if (tx.length !== plan.size) throw new Error('The signed Cardano transaction is not the size its fee priced');
  return { tx, txId: plan.txId, fee: plan.fee };
}

/**
 * Pay `p.amount` lovelace from our base address to `p.to`. Answers the transaction id once the
 * node has accepted the transaction.
 */
export async function sendCardano(p: FamilyTransfer): Promise<string> {
  const { tx, txId } = await prepareCardanoTransfer(p);
  const result = await ogmios(CARDANO_ENDPOINTS[p.env].ogmios, 'submitTransaction', { transaction: { cbor: bytesToHex(tx) } });
  const id = parseShape('ogmios submitTransaction', object({ transaction: object({ id: str }) }), result).transaction.id;
  // Our id is the hash of the body we signed; a node answering another one did not take ours.
  if (id !== txId) throw new Error('The Cardano node answered another transaction id');
  return txId;
}
