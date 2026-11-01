/**
 * Paying on Tron from the wallet's account (m/44'/195'/0'/0/0, the key behind the `T…` address
 * `lib/chainAddresses.ts` shows): TRX itself (`TransferContract`), or the registry's USDT
 * (`TriggerSmartContract` calling `transfer(address,uint256)`). The wallet encodes the
 * transaction's protobuf itself — reference block, expiration, the one contract, `fee_limit` —
 * signs its SHA-256 and hands the bytes to the node. TronGrid's builders
 * (`createtransaction`, `triggersmartcontract`) are never signed: that would be signing a
 * transaction a counterparty built.
 *
 * What keeps a public node from deciding anything:
 *  - **The network.** The node's block 0 must be the mode's genesis (`TRON_GENESIS_BLOCK_ID`), and
 *    the transaction names a recent block of the chain it was built on (`ref_block_bytes` /
 *    `ref_block_hash`): another chain has no such block, so the signature is worthless there.
 *  - **The cost.** Bandwidth (burned at the chain's per-byte price when the account has none
 *    left), a new recipient's activation, and a token transfer's energy are priced with the
 *    chain's parameters, never below the floors in `TRON_MIN_CHAIN_PARAMS`. Their worst case must
 *    fit in `maxFee`, and a token transfer's `fee_limit` is whatever of `maxFee` the bandwidth
 *    leaves: the chain itself never burns more for its energy, whatever the node estimated.
 *  - **Only the coin or `def.tokens`.** Tron carries no memo here.
 *
 * TronGrid answers a keyless caller 3 requests a second, so a send's requests are spaced
 * (`TRON_PACE`) and one refused with a 429 is asked again after the suspension it announces.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { createBase58check } from '@scure/base';
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  TRON_ENERGY_HEADROOM_PCT,
  TRON_EXPIRATION_MS,
  TRON_GENESIS_BLOCK_ID,
  TRON_MIN_CHAIN_PARAMS,
  TRON_RATE_LIMITED_WAIT_MS,
  TRON_RATE_LIMIT_RETRIES,
  TRON_REQUEST_GAP_MS,
  TRON_RESULT_BYTES,
} from '@/constants/tronSend';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* -------------------------------- addresses ------------------------------- */

const base58check = createBase58check(sha256);
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** The 21 bytes (0x41 ‖ account) of a base58check `T…` address, checksum verified; null otherwise. */
export function tronAddressBytes(address: string): Uint8Array | null {
  if (!TRON_ADDRESS_RE.test(address)) return null;
  try {
    const raw = base58check.decode(address);
    return raw.length === 21 && raw[0] === 0x41 ? raw : null;
  } catch {
    return null;
  }
}

/** The 21-byte account of a secp256k1 key: 0x41 ‖ the last 20 bytes of keccak-256 of the uncompressed point. */
export function tronAccountOfKey(publicKey: Uint8Array): Uint8Array {
  const point = secp256k1.Point.fromBytes(publicKey).toBytes(false).subarray(1);
  return concatBytes(Uint8Array.of(0x41), keccak_256(point).subarray(12));
}

export const tronAddressOf = (account: Uint8Array): string => base58check.encode(account);

/**
 * Whether `address` is a recipient Tron takes: a `T…` address with a valid checksum. Nile spells
 * addresses the same way, so the mode changes nothing.
 */
export function isTronAddress(network: NetworkId, address: string, _env: ChainNet): boolean {
  return NETWORKS[network]?.address === 'tron' && tronAddressBytes(address) !== null;
}

/* -------------------------------- protobuf -------------------------------- */

function varint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('Tron varint must not be negative');
  const out: number[] = [];
  let v = value;
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Uint8Array.from(out);
}

const fieldKey = (field: number, wire: 0 | 2) => varint(BigInt((field << 3) | wire));

/** A length-delimited field; proto3 leaves an empty one out. */
const bytesField = (field: number, value: Uint8Array) =>
  value.length === 0 ? new Uint8Array() : concatBytes(fieldKey(field, 2), varint(BigInt(value.length)), value);

/** A varint field; proto3 leaves a zero out. */
const intField = (field: number, value: bigint) => (value === 0n ? new Uint8Array() : concatBytes(fieldKey(field, 0), varint(value)));

/** The one contract a transaction carries: a TRX transfer or a call to a token. Addresses are 21 bytes. */
export type TronCall =
  | { type: 'transfer'; owner: Uint8Array; to: Uint8Array; amount: bigint }
  | { type: 'trigger'; owner: Uint8Array; contract: Uint8Array; data: Uint8Array };

/** `Transaction.Contract`: its type (1 TransferContract, 31 TriggerSmartContract) and the contract as a `google.protobuf.Any`. */
function contractBytes(call: TronCall): Uint8Array {
  const [type, name, value] =
    call.type === 'transfer'
      ? [1n, 'TransferContract', concatBytes(bytesField(1, call.owner), bytesField(2, call.to), intField(3, call.amount))]
      : [31n, 'TriggerSmartContract', concatBytes(bytesField(1, call.owner), bytesField(2, call.contract), bytesField(4, call.data))];
  const any = concatBytes(bytesField(1, utf8ToBytes(`type.googleapis.com/protocol.${name}`)), bytesField(2, value));
  return concatBytes(intField(1, type), bytesField(2, any));
}

export interface TronRaw {
  /** Bytes 6–7 of the reference block's number. */
  refBlockBytes: Uint8Array;
  /** Bytes 8–15 of the reference block's id. */
  refBlockHash: Uint8Array;
  /** Milliseconds. */
  expiration: bigint;
  /** Milliseconds. */
  timestamp: bigint;
  call: TronCall;
  /** Sun; a token call's cap on what its energy may burn. */
  feeLimit?: bigint;
}

/** `Transaction.raw` in field order, as java-tron serializes it (and hashes it into the transaction id). */
export function encodeTronRaw(raw: TronRaw): Uint8Array {
  return concatBytes(
    bytesField(1, raw.refBlockBytes),
    bytesField(4, raw.refBlockHash),
    intField(8, raw.expiration),
    bytesField(11, contractBytes(raw.call)),
    intField(14, raw.timestamp),
    intField(18, raw.feeLimit ?? 0n),
  );
}

/** `transfer(address,uint256)`: the selector, the recipient's 20-byte account and the amount, one word each. */
export function trc20TransferData(to: Uint8Array, amount: bigint): Uint8Array {
  if (amount < 0n || amount >= 1n << 256n) throw new Error('TRC-20 amount out of range');
  const word = (hex: string) => hexToBytes(hex.padStart(64, '0'));
  return concatBytes(hexToBytes('a9059cbb'), word(bytesToHex(to.subarray(1))), word(amount.toString(16)));
}

const SIGNATURE_BYTES = 65;

/** Bytes of the signed `Transaction` (the raw data and one 65-byte signature), what bandwidth is charged on. */
function signedSize(raw: Uint8Array): number {
  return 1 + varint(BigInt(raw.length)).length + raw.length + 2 + SIGNATURE_BYTES;
}

/**
 * Sign `raw`: the transaction id is its SHA-256, signed with an RFC 6979 nonce (low S) as
 * r ‖ s ‖ v with v = 27 + the recovery id — the form TronWeb writes; TRON's account docs
 * (mechanism-algorithm/account.md) take the bare recovery id there too, and a node recovers the
 * signer from either. Answers the id and the signed `Transaction` (raw data, signature).
 */
export function signTronRaw(raw: Uint8Array, secret: Uint8Array): { txID: string; tx: Uint8Array } {
  const digest = sha256(raw);
  const recovered = secp256k1.sign(digest, secret, { prehash: false, lowS: true, format: 'recovered' });
  const signature = concatBytes(recovered.subarray(1, 65), Uint8Array.of(27 + recovered[0]));
  return { txID: bytesToHex(digest), tx: concatBytes(bytesField(1, raw), bytesField(2, signature)) };
}

/* ---------------------------------- node ---------------------------------- */

const STRING_TOKEN = /"(?:[^"\\]|\\.)*"/y;
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/**
 * `JSON.parse` with every integer literal kept as its digit string: TronGrid writes sun as JSON
 * numbers, and a balance past 2^53 sun (~9 billion TRX) would be rounded by `JSON.parse` alone.
 * The same tokenizer as `lib/networkBalances.ts`.
 */
function parseJsonExact(text: string): unknown {
  let out = '';
  let copied = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      STRING_TOKEN.lastIndex = i;
      if (!STRING_TOKEN.test(text)) break;
      i = STRING_TOKEN.lastIndex;
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER_TOKEN.lastIndex = i;
      const m = NUMBER_TOKEN.exec(text);
      if (!m) break;
      if (m[1] === undefined && m[2] === undefined) {
        out += `${text.slice(copied, i)}"${m[0]}"`;
        copied = i + m[0].length;
      }
      i += m[0].length;
    } else {
      i++;
    }
  }
  return JSON.parse(out + text.slice(copied));
}

type Json = Record<string, unknown>;

/** How a send paces its requests: TronGrid without a key takes 3 a second, then blocks the caller for 4 s. */
export interface TronPace {
  /** Between the starts of two requests. */
  gapMs: number;
  /** After a 429, before the same request again. */
  retryMs: number;
}

export const TRON_PACE: TronPace = { gapMs: TRON_REQUEST_GAP_MS, retryMs: TRON_RATE_LIMITED_WAIT_MS };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The next moment a request may start, shared by every send in this context. */
let nextSlot = 0;

/** One node, its requests spaced by `pace` and repeated after a rate limit. */
interface TronIo {
  post(path: string, body: Json): Promise<Json>;
}

function tronIo(api: string, pace: TronPace): TronIo {
  async function once(path: string, body: Json): Promise<Response> {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + pace.gapMs;
    if (at > now) await sleep(at - now);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
    try {
      return await fetch(`${api}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error((e as Error).name === 'AbortError' ? `Tron ${path}: timed out` : `Tron ${path}: no answer`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // A 429 is TronGrid's gateway refusing the request before any node saw it, so repeating it —
    // a broadcast included — cannot do anything twice. Its error text is never repeated: it may
    // echo an address.
    async post(path, body) {
      for (let attempt = 0; ; attempt++) {
        const res = await once(path, body);
        if (res.status === 429 && attempt < TRON_RATE_LIMIT_RETRIES) {
          await sleep(pace.retryMs);
          continue;
        }
        if (!res.ok) throw new Error(`Tron ${path}: HTTP ${res.status}`);
        const parsed = parseJsonExact(await res.text());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Tron ${path}: unexpected answer`);
        if ('Error' in parsed) throw new Error(`Tron ${path} failed`);
        return parsed as Json;
      }
    },
  };
}

const shape = (path: string): never => {
  throw new Error(`Tron ${path}: unexpected answer`);
};

/** An unsigned integer as `parseJsonExact` leaves it; absent is zero only where TronGrid omits zeros. */
function uint(v: unknown, path: string, absentIsZero = false): bigint {
  if (v === undefined && absentIsZero) return 0n;
  return typeof v === 'string' && /^\d{1,30}$/.test(v) ? BigInt(v) : shape(path);
}

const HEX_ID = /^[0-9a-f]{64}$/;

async function genesisAt(io: TronIo): Promise<string> {
  const block = await io.post('/wallet/getblock', { id_or_num: '0', detail: false });
  return typeof block.blockID === 'string' ? block.blockID.toLowerCase() : shape('/wallet/getblock');
}

/** The head block: its id, number and time. The id's first 8 bytes are the number, which is checked. */
async function headAt(io: TronIo): Promise<{ id: Uint8Array; number: bigint; timestamp: bigint }> {
  const block = await io.post('/wallet/getblock', { detail: false });
  const raw = (block.block_header as Json | undefined)?.raw_data as Json | undefined;
  const id = typeof block.blockID === 'string' ? block.blockID.toLowerCase() : '';
  if (!raw || !HEX_ID.test(id)) return shape('/wallet/getblock');
  const number = uint(raw.number, '/wallet/getblock');
  if (BigInt(`0x${id.slice(0, 16)}`) !== number) return shape('/wallet/getblock');
  return { id: hexToBytes(id), number, timestamp: uint(raw.timestamp, '/wallet/getblock') };
}

interface ChainPrices {
  transactionFee: bigint;
  energyFee: bigint;
  createAccountFee: bigint;
  createNewAccountFeeInSystemContract: bigint;
  createNewAccountBandwidthRate: bigint;
  maxFeeLimit: bigint | null;
}

/** The prices a send pays, from `getchainparameters` (its other keys are flags, some negative, none read here). */
async function pricesAt(io: TronIo): Promise<ChainPrices> {
  const path = '/wallet/getchainparameters';
  const body = await io.post(path, {});
  if (!Array.isArray(body.chainParameter)) return shape(path);
  const entries = new Map<string, unknown>();
  for (const entry of body.chainParameter as Json[]) if (typeof entry?.key === 'string') entries.set(entry.key, entry.value);
  // A listed parameter without a value is zero: TronGrid omits every zero field.
  const read = (key: string) => (entries.has(key) ? uint(entries.get(key), path, true) : undefined);
  const atLeast = (key: string, floor: bigint) => {
    const v = read(key);
    return v !== undefined && v > floor ? v : floor;
  };
  return {
    transactionFee: atLeast('getTransactionFee', TRON_MIN_CHAIN_PARAMS.transactionFee),
    energyFee: atLeast('getEnergyFee', TRON_MIN_CHAIN_PARAMS.energyFee),
    createAccountFee: atLeast('getCreateAccountFee', TRON_MIN_CHAIN_PARAMS.createAccountFee),
    createNewAccountFeeInSystemContract: atLeast('getCreateNewAccountFeeInSystemContract', TRON_MIN_CHAIN_PARAMS.createNewAccountFeeInSystemContract),
    createNewAccountBandwidthRate: atLeast('getCreateNewAccountBandwidthRate', 1n),
    maxFeeLimit: read('getMaxFeeLimit') ?? null,
  };
}

/** The account's TRX in sun, or null when it was never activated (TronGrid answers `{}`). */
async function trxBalanceAt(io: TronIo, address: string): Promise<bigint | null> {
  const account = await io.post('/wallet/getaccount', { address, visible: true });
  if (Object.keys(account).length === 0) return null;
  return uint(account.balance, '/wallet/getaccount', true);
}

/** Bandwidth and energy the account has left now (java-tron applies the 24 h recovery before answering). */
async function resourcesAt(io: TronIo, address: string): Promise<{ freeNet: bigint; stakedNet: bigint; energy: bigint }> {
  const r = await io.post('/wallet/getaccountresource', { address, visible: true });
  const n = (key: string) => uint(r[key], '/wallet/getaccountresource', true);
  const left = (limit: string, used: string) => (n(limit) > n(used) ? n(limit) - n(used) : 0n);
  return { freeNet: left('freeNetLimit', 'freeNetUsed'), stakedNet: left('NetLimit', 'NetUsed'), energy: left('EnergyLimit', 'EnergyUsed') };
}

/** A read-only call of the token (`triggerconstantcontract`): its one return word and the energy it used. */
async function constantCallAt(
  io: TronIo,
  owner: string,
  contract: string,
  selector: string,
  parameter: Uint8Array,
): Promise<{ word: bigint; energy: bigint }> {
  const path = '/wallet/triggerconstantcontract';
  const r = await io.post(path, {
    owner_address: owner,
    contract_address: contract,
    function_selector: selector,
    parameter: bytesToHex(parameter),
    visible: true,
  });
  const result = r.result as Json | undefined;
  // A revert (a frozen account, a paused token) or a node that could not run the call.
  if (result?.result !== true) throw new Error(`Tron ${path}: the token call does not run`);
  const words = r.constant_result;
  const word = Array.isArray(words) && typeof words[0] === 'string' && /^[0-9a-f]{64}$/i.test(words[0]) ? BigInt(`0x${words[0]}`) : shape(path);
  return { word, energy: uint(r.energy_used, path, true) };
}

/**
 * Hand the signed transaction to the node; refused unless it answers `result: true`. A
 * `DUP_TRANSACTION_ERROR` means the node already holds this very transaction — its id covers our
 * signature and millisecond timestamp — so it was taken.
 */
async function broadcastAt(io: TronIo, tx: Uint8Array, txID: string): Promise<void> {
  const r = await io.post('/wallet/broadcasthex', { transaction: bytesToHex(tx) });
  const code = typeof r.code === 'string' && /^\w+$/.test(r.code) ? r.code : 'unknown';
  if (r.result !== true && code !== 'DUP_TRANSACTION_ERROR') throw new Error(`Tron refused the transaction: ${code}`);
  if (typeof r.txid === 'string' && r.txid.toLowerCase() !== txID) throw new Error('Tron broadcast answered another transaction');
}

/* ---------------------------------- send ---------------------------------- */

const maxOf = (a: bigint, b: bigint) => (a > b ? a : b);

/**
 * Pay `p.amount` (sun, or the token's minor units) of TRX or a registry token to `p.to`. Answers
 * the transaction id (hex, as Tronscan shows it) once the node has accepted the transaction.
 */
export async function sendTron(p: FamilyTransfer, pace: TronPace = TRON_PACE): Promise<string> {
  const source = p.def.balance;
  if (NETWORKS[p.network]?.address !== 'tron' || source?.kind !== 'trongrid') throw new ChainSwapRefused('chain');
  const token = p.asset === 'native' ? null : p.def.tokens.find((t) => t.asset === p.asset);
  if (p.asset !== 'native' && !token) throw new ChainSwapRefused('address');
  const tokenContract = token ? tronAddressBytes(token.asset) : null;
  if (token && !tokenContract) throw new ChainSwapRefused('address');
  const to = tronAddressBytes(p.to);
  if (!to) throw new ChainSwapRefused('address');
  if ((p.memo?.trim() ?? '') !== '') throw new ChainSwapRefused('memo');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');

  const owner = tronAccountOfKey(secp256k1.getPublicKey(p.secret, true));
  if (tronAddressOf(owner) !== p.owner) throw new Error('The Tron key does not control the sending account');
  // TRX to oneself is refused by the chain; a token to oneself would only burn the fee.
  if (owner.every((b, i) => b === to[i])) throw new ChainSwapRefused('address');

  const io = tronIo(source.api.replace(/\/+$/, ''), pace);
  if ((await genesisAt(io)) !== TRON_GENESIS_BLOCK_ID[p.env]) throw new ChainSwapRefused('chain');

  const [prices, balance, resources, recipientBalance, tokenBalance] = await Promise.all([
    pricesAt(io),
    trxBalanceAt(io, p.owner),
    resourcesAt(io, p.owner),
    token ? Promise.resolve(null) : trxBalanceAt(io, p.to),
    token ? constantCallAt(io, p.owner, token.asset, 'balanceOf(address)', hexToBytes(bytesToHex(owner.subarray(1)).padStart(64, '0'))) : null,
  ]);
  if (balance === null) throw new ChainSwapRefused('unfunded');
  if (tokenBalance && tokenBalance.word < p.amount) throw new ChainSwapRefused('funds');

  const call: TronCall =
    token && tokenContract
      ? { type: 'trigger', owner, contract: tokenContract, data: trc20TransferData(to, p.amount) }
      : { type: 'transfer', owner, to, amount: p.amount };
  // The energy estimate runs the transfer as the chain would; it is the node's word, which
  // `fee_limit` bounds on the chain whatever it said.
  const [estimate, head] = await Promise.all([
    token ? constantCallAt(io, p.owner, token.asset, 'transfer(address,uint256)', call.type === 'trigger' ? call.data.subarray(4) : new Uint8Array()) : null,
    headAt(io),
  ]);
  const ref = {
    refBlockBytes: hexToBytes(head.number.toString(16).padStart(16, '0')).subarray(6, 8),
    refBlockHash: head.id.slice(8, 16),
    expiration: head.timestamp + BigInt(TRON_EXPIRATION_MS),
    timestamp: BigInt(Date.now()),
  };

  // Bandwidth is charged on the signed transaction plus the result java-tron stores with it;
  // sized here with `fee_limit` at its largest possible value, so the real one is no bigger.
  const bytes = BigInt(signedSize(encodeTronRaw({ ...ref, call, feeLimit: token ? p.maxFee : undefined })) + TRON_RESULT_BYTES);
  const bandwidthBurn = bytes * prices.transactionFee;
  const bandwidthFree = resources.stakedNet >= bytes || resources.freeNet >= bytes;

  let feeLimit: bigint | undefined;
  let expected: bigint;
  if (estimate) {
    // `fee_limit` caps the energy a call may use in TRX terms — staked energy included — so the
    // whole estimate must fit under it, and it is set to what `maxFee` leaves after bandwidth.
    feeLimit = p.maxFee - bandwidthBurn;
    if (prices.maxFeeLimit !== null && feeLimit > prices.maxFeeLimit) feeLimit = prices.maxFeeLimit;
    const energy = (estimate.energy * TRON_ENERGY_HEADROOM_PCT + 99n) / 100n;
    if (feeLimit <= 0n || energy * prices.energyFee > feeLimit) throw new ChainSwapRefused('fee');
    expected = (bandwidthFree ? 0n : bandwidthBurn) + maxOf(0n, energy - resources.energy) * prices.energyFee;
    if (balance < expected) throw new ChainSwapRefused('funds');
  } else {
    // A TRX transfer to an account that does not exist activates it: the system contract's fee,
    // and the account's creation paid with staked bandwidth or burned — free bandwidth never pays it.
    const activation = recipientBalance === null;
    const creation = resources.stakedNet >= bytes * prices.createNewAccountBandwidthRate ? 0n : prices.createAccountFee;
    const worst = activation ? prices.createNewAccountFeeInSystemContract + prices.createAccountFee : bandwidthBurn;
    if (worst > p.maxFee) throw new ChainSwapRefused('fee');
    expected = activation ? prices.createNewAccountFeeInSystemContract + creation : bandwidthFree ? 0n : bandwidthBurn;
    if (balance < p.amount + expected) throw new ChainSwapRefused('funds');
  }

  const { txID, tx } = signTronRaw(encodeTronRaw({ ...ref, call, feeLimit }), p.secret);
  await broadcastAt(io, tx, txID);
  return txID;
}
