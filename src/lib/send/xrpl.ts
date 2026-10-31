/**
 * Paying XRP on the XRP Ledger: a `Payment` of drops from the wallet's classic account, which the
 * wallet serializes in the ledger's canonical binary format and signs with its secp256k1 key
 * (m/44'/144'/0'/0/0, the key behind the `r…` address `lib/chainAddresses.ts` shows). The node is
 * asked for state — the account's sequence and balance, the fee, the reserves — and to relay the
 * signed blob; it builds nothing.
 *
 * What keeps a public node from deciding anything:
 *  - **The network.** XRPL signatures carry no network id below 1025, so the node's `network_id`
 *    is checked against the mode's, and `LastLedgerSequence` ties the payment to the ledger range
 *    of the network it was built on: a test payment expires below the main network's ledger
 *    floor (`XRPL_MAINNET_LEDGER_FLOOR`), so the same key's main account can never replay it.
 *  - **The fee** is the node's open-ledger fee, refused above `maxFee`.
 *  - **The reserves.** The sender keeps its reserve (base + one increment per owned object), and
 *    a payment that would create the recipient's account carries at least the base reserve —
 *    otherwise the ledger fails it with a `tec` code, which still burns the fee.
 *  - **The destination tag** is the person's memo, or the tag an X-address carries; never both
 *    disagreeing, and never missing where the recipient's account demands one.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { base58xrp } from '@scure/base';
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  XRPL_ACCEPTED_RESULTS,
  XRPL_LEDGER_WINDOW,
  XRPL_LSF_DEPOSIT_AUTH,
  XRPL_LSF_REQUIRE_DEST_TAG,
  XRPL_MAINNET_LEDGER_FLOOR,
  XRPL_MAX_DROPS,
  XRPL_NETWORK_ID,
  XRPL_X_ADDRESS_PREFIX,
} from '@/constants/xrplSend';
import { hash160 } from '@/lib/addresses/utxo';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* -------------------------------- addresses ------------------------------- */

const checksum = (payload: Uint8Array) => sha256(sha256(payload)).subarray(0, 4);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The `length`-byte payload of a base58check string in Ripple's alphabet, or null. */
function decodeChecked(text: string, length: number): Uint8Array | null {
  let raw: Uint8Array;
  try {
    raw = base58xrp.decode(text);
  } catch {
    return null;
  }
  if (raw.length !== length + 4) return null;
  const payload = raw.subarray(0, length);
  return sameBytes(raw.subarray(length), checksum(payload)) ? payload : null;
}

/** The 20-byte account id of a classic `r…` address (version 0x00, checksum verified), or null. */
export function xrplAccountId(address: string): Uint8Array | null {
  const payload = decodeChecked(address, 21);
  return payload && payload[0] === 0x00 ? payload.slice(1) : null;
}

/** The classic address of a 20-byte account id. */
export function xrplClassicAddress(accountId: Uint8Array): string {
  const payload = concatBytes(Uint8Array.of(0x00), accountId);
  return base58xrp.encode(concatBytes(payload, checksum(payload)));
}

/** The classic address a compressed secp256k1 public key signs for. */
export const xrplAddressOfKey = (publicKey: Uint8Array): string => xrplClassicAddress(hash160(publicKey));

/**
 * An X-address of `env` (XLS-5d: two prefix bytes, the account id, a flag and a 64-bit little-endian
 * tag field of which only the low 32 bits may be used): its account id and destination tag. Null
 * for anything else, including an X-address of the other mode.
 */
export function xrplXAddress(address: string, env: ChainNet): { accountId: Uint8Array; tag: number | null } | null {
  const payload = decodeChecked(address, 31);
  if (!payload) return null;
  const [p0, p1] = XRPL_X_ADDRESS_PREFIX[env];
  if (payload[0] !== p0 || payload[1] !== p1) return null;
  const flag = payload[22];
  const tagBytes = payload.subarray(23, 31);
  if (tagBytes.subarray(4).some((b) => b !== 0)) return null;
  const tag = (tagBytes[0] | (tagBytes[1] << 8) | (tagBytes[2] << 16) | (tagBytes[3] << 24)) >>> 0;
  if (flag === 0) return tag === 0 ? { accountId: payload.slice(2, 22), tag: null } : null;
  return flag === 1 ? { accountId: payload.slice(2, 22), tag } : null;
}

/**
 * Whether `address` is a recipient the XRP Ledger takes in `env`: a classic `r…` address (the
 * same on every XRPL network), or an X-address of that mode (`X…` main, `T…` test).
 */
export function isXrplAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  if (NETWORKS[network]?.address !== 'xrp') return false;
  return xrplAccountId(address) !== null || xrplXAddress(address, env) !== null;
}

const TAG_RE = /^\d{1,10}$/;

/** A destination tag as typed: absent (undefined), a uint32, or null when it is not one. */
function parseTag(memo: string | undefined): number | undefined | null {
  const text = memo?.trim() ?? '';
  if (text === '') return undefined;
  if (!TAG_RE.test(text)) return null;
  const n = Number(text);
  return n <= 0xffff_ffff ? n : null;
}

/* ------------------------------ serialization ----------------------------- */

/** An XRP `Payment` with the fields this wallet sets — no paths, no partial payments, no memos. */
export interface XrplPayment {
  account: Uint8Array;
  destination: Uint8Array;
  /** Drops. */
  amount: bigint;
  /** Drops. */
  fee: bigint;
  sequence: number;
  flags: number;
  lastLedgerSequence?: number;
  destinationTag?: number;
  /** 33-byte compressed secp256k1 key. */
  signingPubKey: Uint8Array;
  /** DER signature; absent in the bytes that are signed. */
  txnSignature?: Uint8Array;
}

/** "STX\0", "TXN\0": the hash prefixes of a single-signed transaction and of a transaction id. */
const PREFIX_SIGN = Uint8Array.of(0x53, 0x54, 0x58, 0x00);
const PREFIX_TX_ID = Uint8Array.of(0x54, 0x58, 0x4e, 0x00);

const sha512Half = (data: Uint8Array) => sha512(data).subarray(0, 32);

/** A field id: type code and field code, one byte when both are below 16, two when only the type is. */
const fieldId = (type: number, field: number) => (field < 16 ? Uint8Array.of((type << 4) | field) : Uint8Array.of(type << 4, field));

function uint16(v: number): Uint8Array {
  return Uint8Array.of((v >>> 8) & 0xff, v & 0xff);
}

function uint32(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new Error('XRPL UInt32 out of range');
  return Uint8Array.of(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

/** An XRP amount: 64 bits, the "not an IOU" bit clear, the "positive" bit set, then the drops. */
function xrpAmount(drops: bigint): Uint8Array {
  if (drops < 0n || drops > XRPL_MAX_DROPS) throw new Error('XRP amount out of range');
  const v = drops | 0x4000_0000_0000_0000n;
  const out = new Uint8Array(8);
  for (let i = 7, x = v; i >= 0; i--, x >>= 8n) out[i] = Number(x & 0xffn);
  return out;
}

/** A variable-length field (a blob, an account id) with its length prefix; every one here is under 193 bytes. */
function vl(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 192) throw new Error('XRPL variable-length field too long');
  return concatBytes(Uint8Array.of(bytes.length), bytes);
}

/**
 * The canonical binary form: fields sorted by type code, then field code — UInt16 (1)
 * TransactionType, UInt32 (2) Flags · Sequence · DestinationTag · LastLedgerSequence, Amount (6)
 * Amount · Fee, Blob (7) SigningPubKey · TxnSignature, AccountID (8) Account · Destination.
 */
export function encodeXrplPayment(tx: XrplPayment): Uint8Array {
  const parts: Uint8Array[] = [
    fieldId(1, 2), uint16(0), // TransactionType: Payment
    fieldId(2, 2), uint32(tx.flags),
    fieldId(2, 4), uint32(tx.sequence),
  ];
  if (tx.destinationTag !== undefined) parts.push(fieldId(2, 14), uint32(tx.destinationTag));
  if (tx.lastLedgerSequence !== undefined) parts.push(fieldId(2, 27), uint32(tx.lastLedgerSequence));
  parts.push(fieldId(6, 1), xrpAmount(tx.amount), fieldId(6, 8), xrpAmount(tx.fee));
  parts.push(fieldId(7, 3), vl(tx.signingPubKey));
  if (tx.txnSignature) parts.push(fieldId(7, 4), vl(tx.txnSignature));
  parts.push(fieldId(8, 1), vl(tx.account), fieldId(8, 3), vl(tx.destination));
  return concatBytes(...parts);
}

/** A transaction's id: SHA-512Half of "TXN\0" ‖ the signed blob, uppercase hex as explorers show it. */
export const xrplTxId = (blob: Uint8Array): string => bytesToHex(sha512Half(concatBytes(PREFIX_TX_ID, blob))).toUpperCase();

/**
 * Sign a payment: SHA-512Half of "STX\0" ‖ the fields without `TxnSignature`, ECDSA over secp256k1
 * with an RFC 6979 nonce, low S (the only form the ledger accepts since `RequireFullyCanonicalSig`),
 * DER-encoded. Answers the signed blob and its transaction id.
 */
export function signXrplPayment(tx: Omit<XrplPayment, 'txnSignature'>, secret: Uint8Array): { blob: Uint8Array; hash: string } {
  const digest = sha512Half(concatBytes(PREFIX_SIGN, encodeXrplPayment(tx)));
  const txnSignature = secp256k1.sign(digest, secret, { prehash: false, lowS: true, format: 'der' });
  const blob = encodeXrplPayment({ ...tx, txnSignature });
  return { blob, hash: xrplTxId(blob) };
}

/* ---------------------------------- node ---------------------------------- */

type Result = Record<string, unknown>;

/** One rippled JSON-RPC call; answers `result`, whose `status`/`error` the caller reads. */
async function call(rpc: string, method: string, params: Record<string, unknown>): Promise<Result> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params: [params] }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`XRPL ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown };
    if (!body.result || typeof body.result !== 'object') throw new Error(`XRPL ${method}: unexpected answer`);
    return body.result as Result;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`XRPL ${method}: timed out`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The node's own error code (`actNotFound`, `slowDown`…). Its message is not repeated: it may echo the address. */
const errorCode = (r: Result): string | null => (r.status === 'error' || r.error !== undefined ? (typeof r.error === 'string' && /^\w+$/.test(r.error) ? r.error : 'error') : null);

function failed(method: string, r: Result): never {
  throw new Error(`XRPL ${method} failed: ${errorCode(r) ?? 'error'}`);
}

const shape = (method: string): never => {
  throw new Error(`XRPL ${method}: unexpected answer`);
};

const isUint = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const drops = (v: unknown, method: string): bigint => (typeof v === 'string' && /^\d{1,18}$/.test(v) ? BigInt(v) : isUint(v) ? BigInt(v) : shape(method));

interface XrplAccount {
  balance: bigint;
  sequence: number;
  ownerCount: number;
  flags: number;
}

/** The account in the current ledger, or null when it does not exist (nobody has funded it). */
async function accountAt(rpc: string, address: string): Promise<XrplAccount | null> {
  const r = await call(rpc, 'account_info', { account: address, ledger_index: 'current' });
  const error = errorCode(r);
  if (error === 'actNotFound') return null;
  if (error) failed('account_info', r);
  const data = r.account_data as Record<string, unknown> | undefined;
  if (!data || !isUint(data.Sequence) || !isUint(data.OwnerCount) || !isUint(data.Flags)) return shape('account_info');
  return { balance: drops(data.Balance, 'account_info'), sequence: data.Sequence, ownerCount: data.OwnerCount, flags: data.Flags };
}

/** The node's network id, last validated ledger and reserves, in drops (`server_state`, not `server_info`'s XRP floats). */
async function serverStateAt(rpc: string): Promise<{ networkId: number | null; ledger: number; reserveBase: bigint; reserveInc: bigint }> {
  const r = await call(rpc, 'server_state', {});
  if (errorCode(r)) failed('server_state', r);
  const state = r.state as Record<string, unknown> | undefined;
  const ledger = state?.validated_ledger as Record<string, unknown> | undefined;
  if (!state || !ledger || !isUint(ledger.seq)) return shape('server_state');
  return {
    networkId: isUint(state.network_id) ? state.network_id : null,
    ledger: ledger.seq,
    reserveBase: drops(ledger.reserve_base, 'server_state'),
    reserveInc: drops(ledger.reserve_inc, 'server_state'),
  };
}

/** What a transaction must pay to enter the open ledger now, never below the base fee. */
async function openLedgerFeeAt(rpc: string): Promise<bigint> {
  const r = await call(rpc, 'fee', {});
  if (errorCode(r)) failed('fee', r);
  const fees = r.drops as Record<string, unknown> | undefined;
  if (!fees) return shape('fee');
  const open = drops(fees.open_ledger_fee, 'fee');
  const base = drops(fees.base_fee, 'fee');
  return open > base ? open : base;
}

/** Whether a deposit-authorising recipient takes payments from `source` (pre-authorised). */
async function depositAuthorizedAt(rpc: string, source: string, destination: string): Promise<boolean> {
  const r = await call(rpc, 'deposit_authorized', { source_account: source, destination_account: destination, ledger_index: 'current' });
  if (errorCode(r)) failed('deposit_authorized', r);
  if (typeof r.deposit_authorized !== 'boolean') return shape('deposit_authorized');
  return r.deposit_authorized;
}

/* ---------------------------------- send ---------------------------------- */

/**
 * Pay `p.amount` drops of XRP to `p.to` (a classic address or an X-address of the mode), with
 * `p.memo` as the destination tag. Answers the transaction id (uppercase hex, as explorers show
 * it) once the node has applied or queued the payment.
 */
export async function sendXrpl(p: FamilyTransfer): Promise<string> {
  const source = p.def.balance;
  if (NETWORKS[p.network]?.address !== 'xrp' || source?.kind !== 'xrpl') throw new ChainSwapRefused('chain');
  // XRP only: the ledger's issued currencies are trust lines the screen never offers here.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');

  const classic = xrplAccountId(p.to);
  const x = classic ? null : xrplXAddress(p.to, p.env);
  const destination = classic ?? x?.accountId;
  if (!destination) throw new ChainSwapRefused('address');
  const typed = parseTag(p.memo);
  if (typed === null) throw new ChainSwapRefused('memo');
  // An X-address carries its tag; a different one typed beside it is ambiguous, not a choice.
  if (x?.tag != null && typed !== undefined && typed !== x.tag) throw new ChainSwapRefused('memo');
  const destinationTag = x?.tag ?? typed;
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  if (p.amount > XRPL_MAX_DROPS) throw new ChainSwapRefused('funds');

  const signingPubKey = secp256k1.getPublicKey(p.secret, true);
  const account = hash160(signingPubKey);
  if (xrplClassicAddress(account) !== p.owner) throw new Error('The XRP key does not control the sending account');
  // A payment to oneself is `temREDUNDANT`: nothing would move but the fee.
  if (sameBytes(account, destination)) throw new ChainSwapRefused('address');

  const rpc = source.rpc;
  const server = await serverStateAt(rpc);
  const onMain = server.ledger >= XRPL_MAINNET_LEDGER_FLOOR;
  if (server.networkId !== XRPL_NETWORK_ID[p.env] || onMain !== (p.env === 'mainnet')) throw new ChainSwapRefused('chain');
  const lastLedgerSequence = server.ledger + XRPL_LEDGER_WINDOW;
  // The binding of a test payment: it expires before any main-network ledger it could enter.
  if (p.env !== 'mainnet' && lastLedgerSequence >= XRPL_MAINNET_LEDGER_FLOOR) throw new ChainSwapRefused('chain');

  const to = xrplClassicAddress(destination);
  const [owner, recipient, fee] = await Promise.all([accountAt(rpc, p.owner), accountAt(rpc, to), openLedgerFeeAt(rpc)]);
  if (!owner) throw new ChainSwapRefused('unfunded');
  if (fee > p.maxFee) throw new ChainSwapRefused('fee');
  // The account keeps its reserve: the base plus one increment per object it owns (trust lines,
  // offers…). The ledger checks the amount against the balance before the fee; keeping the fee
  // on top as well leaves the account able to pay for its next transaction.
  const reserve = server.reserveBase + server.reserveInc * BigInt(owner.ownerCount);
  if (owner.balance - p.amount - fee < reserve) throw new ChainSwapRefused('funds');
  if (!recipient) {
    // The payment creates the account: less than the base reserve is `tecNO_DST_INSUF_XRP`.
    if (p.amount < server.reserveBase) throw new ChainSwapRefused('minimum');
  } else {
    if ((recipient.flags & XRPL_LSF_REQUIRE_DEST_TAG) !== 0 && destinationTag === undefined) throw new ChainSwapRefused('memo');
    if ((recipient.flags & XRPL_LSF_DEPOSIT_AUTH) !== 0 && !(await depositAuthorizedAt(rpc, p.owner, to))) throw new ChainSwapRefused('address');
  }

  const { blob, hash } = signXrplPayment(
    {
      account,
      destination,
      amount: p.amount,
      fee,
      sequence: owner.sequence,
      flags: 0,
      lastLedgerSequence,
      destinationTag,
      signingPubKey,
    },
    p.secret,
  );
  const r = await call(rpc, 'submit', { tx_blob: bytesToHex(blob).toUpperCase() });
  if (errorCode(r)) failed('submit', r);
  const result = typeof r.engine_result === 'string' && /^\w+$/.test(r.engine_result) ? r.engine_result : null;
  if (!result) return shape('submit');
  if (!XRPL_ACCEPTED_RESULTS.includes(result)) throw new Error(`XRPL refused the payment: ${result}`);
  // The node's copy of what it took must be the payment signed here.
  const echoed = (r.tx_json as Record<string, unknown> | undefined)?.hash;
  if (typeof echoed === 'string' && echoed.toUpperCase() !== hash) throw new Error('XRPL submit answered another transaction');
  return hash;
}
