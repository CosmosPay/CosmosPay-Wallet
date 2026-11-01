/**
 * Paying on the Move networks: APT on Aptos and MOVE on Movement (`lib/send/types.ts` is the
 * contract). Both run the Aptos framework, so one sender serves both; `def` says which node,
 * and `APTOS_CHAIN_ID` which network that node must be.
 *
 * The transfer is `0x1::aptos_account::transfer(to, amount)`, built and signed here byte by byte
 * (BCS): a `RawTransaction` whose `chain_id` is signed, so the signature is worthless on any
 * other network, and whose `max_gas_amount × gas_unit_price` is the most it can ever cost. The
 * node is asked for state (sequence number, balance, gas price), for a simulation and to relay —
 * never to decide: its chain id is checked against the constant before anything is signed, and
 * whatever it says gas costs, the signed ceiling is clamped to `maxFee`.
 *
 * A node's simulation refuses a transaction whose signature is VALID (it would otherwise be a
 * free way to broadcast), so the simulation carries an all-zero signature; that refusal is also
 * how the signing message was checked against Aptos' and Movement's mainnet nodes (2026-10-29).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ChainNet } from '@/constants/chains';
import { CHAIN_RPC_TIMEOUT_MS } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  APTOS_CHAIN_ID,
  APTOS_GAS_HEADROOM_PCT,
  APTOS_MAX_GAS_UNITS,
  APTOS_NATIVE_COIN,
  APTOS_TX_EXPIRATION_SECS,
  type AptosNetworkId,
} from '@/constants/aptosSend';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* --------------------------------- addresses --------------------------------- */

const LONG_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const SPECIAL_ADDRESS_RE = /^0x[0-9a-fA-F]$/;

/**
 * An account address as AIP-40 parses it strictly: `0x` and 64 hex digits, or the short form
 * of a special address (`0x0`–`0xf`), which is the same 32 bytes left-padded. A non-special
 * address written short is refused: it is how a digit dropped in a copy would still "parse".
 */
export function parseAptosAddress(text: string): Uint8Array | null {
  if (LONG_ADDRESS_RE.test(text)) return hexToBytes(text.slice(2));
  if (SPECIAL_ADDRESS_RE.test(text)) {
    const out = new Uint8Array(32);
    out[31] = parseInt(text.slice(2), 16);
    return out;
  }
  return null;
}

const isMoveNetwork = (network: NetworkId): network is AptosNetworkId => NETWORKS[network].address === 'aptos';

/** Whether `address` is an account on `network` (Aptos or Movement). The format names no network, so `env` changes nothing. */
export function isAptosAddress(network: NetworkId, address: string, _env: ChainNet): boolean {
  return isMoveNetwork(network) && parseAptosAddress(address) !== null;
}

/** The account a 32-byte ed25519 seed controls: sha3-256(public key ‖ 0x00), the single-Ed25519 scheme. */
export function aptosAddressOf(publicKey: Uint8Array): string {
  return `0x${bytesToHex(sha3_256(concatBytes(publicKey, Uint8Array.of(0x00))))}`;
}

/* ------------------------------------ BCS ------------------------------------ */

function uleb128(value: number): Uint8Array {
  const out: number[] = [];
  let v = value;
  do {
    const byte = v & 0x7f;
    v >>>= 7;
    out.push(v ? byte | 0x80 : byte);
  } while (v);
  return Uint8Array.from(out);
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error('u64 out of range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** A BCS `vector<u8>` (and `String`, `Identifier`): its length, then the bytes. */
const bytesBcs = (b: Uint8Array) => concatBytes(uleb128(b.length), b);
const strBcs = (s: string) => bytesBcs(utf8ToBytes(s));

/** `TransactionPayload::EntryFunction` — the variant index the Aptos type gives it. */
const PAYLOAD_ENTRY_FUNCTION = 2;
/** `TransactionAuthenticator::Ed25519`. */
const AUTHENTICATOR_ED25519 = 0;
/** `Transaction::UserTransaction`, the variant a submitted transaction is hashed as. */
const TRANSACTION_USER = 0;

export interface AptosTransferFields {
  sender: Uint8Array;
  sequenceNumber: bigint;
  to: Uint8Array;
  amount: bigint;
  maxGasAmount: bigint;
  gasUnitPrice: bigint;
  expirationSecs: bigint;
  chainId: number;
}

/** `bcs(RawTransaction)` of `0x1::aptos_account::transfer(to, amount)`. */
export function aptosTransferRaw(f: AptosTransferFields): Uint8Array {
  if (f.sender.length !== 32 || f.to.length !== 32) throw new Error('an account address is 32 bytes');
  if (!Number.isInteger(f.chainId) || f.chainId < 1 || f.chainId > 255) throw new Error('chain id is a u8');
  const framework = new Uint8Array(32);
  framework[31] = 1;
  // EntryFunction { module: 0x1::aptos_account, function: transfer, ty_args: [], args: [bcs(to), bcs(amount)] }
  const entry = concatBytes(
    framework,
    strBcs('aptos_account'),
    strBcs('transfer'),
    uleb128(0),
    uleb128(2),
    bytesBcs(f.to),
    bytesBcs(u64(f.amount)),
  );
  return concatBytes(
    f.sender,
    u64(f.sequenceNumber),
    uleb128(PAYLOAD_ENTRY_FUNCTION),
    entry,
    u64(f.maxGasAmount),
    u64(f.gasUnitPrice),
    u64(f.expirationSecs),
    Uint8Array.of(f.chainId),
  );
}

const RAW_TX_SALT = sha3_256(utf8ToBytes('APTOS::RawTransaction'));
const TX_SALT = sha3_256(utf8ToBytes('APTOS::Transaction'));

/** What an Ed25519 key signs for a raw transaction: the domain-separated hash prefix, then the bytes. */
export const aptosSigningMessage = (raw: Uint8Array): Uint8Array => concatBytes(RAW_TX_SALT, raw);

/** `bcs(SignedTransaction)`: the raw transaction and its single-Ed25519 authenticator. */
export function aptosSignedTx(raw: Uint8Array, publicKey: Uint8Array, signature: Uint8Array): Uint8Array {
  if (publicKey.length !== 32 || signature.length !== 64) throw new Error('an Ed25519 key is 32 bytes and a signature 64');
  return concatBytes(raw, uleb128(AUTHENTICATOR_ED25519), bytesBcs(publicKey), bytesBcs(signature));
}

/** The transaction's hash, as the node and the explorers name it. */
export const aptosTxHash = (signed: Uint8Array): string =>
  `0x${bytesToHex(sha3_256(concatBytes(TX_SALT, Uint8Array.of(TRANSACTION_USER), signed)))}`;

/* ------------------------------------ node ------------------------------------ */

const BCS_SIGNED_TX = 'application/x.aptos.signed_transaction+bcs';

interface NodeAnswer {
  status: number;
  text: string;
}

/** One request to the node. No credentials and no referrer: Movement's node sets a cookie, and nothing about the person goes along. */
async function call(url: string, init: { method?: 'GET' | 'POST'; body?: Uint8Array } = {}): Promise<NodeAnswer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'content-type': BCS_SIGNED_TX, accept: 'application/json' } : { accept: 'application/json' },
      body: init.body as BodyInit | undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'Move node: timed out' : 'Move node: unreachable');
  } finally {
    clearTimeout(timer);
  }
}

function json(answer: NodeAnswer, what: string): Record<string, unknown> {
  if (answer.status < 200 || answer.status > 299) throw new Error(`Move node: ${what} answered HTTP ${answer.status}`);
  try {
    const body: unknown = JSON.parse(answer.text);
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {
    // fall through to the shape error
  }
  throw new Error(`Move node: ${what} is not JSON`);
}

/** A u64 the node wrote as a decimal string (or a small JSON number), read exactly. */
function u64Of(value: unknown, what: string): bigint {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,20}$/.test(text)) throw new Error(`Move node: ${what} is not an integer`);
  const n = BigInt(text);
  if (n > 0xffff_ffff_ffff_ffffn) throw new Error(`Move node: ${what} is out of range`);
  return n;
}

/**
 * The account's sequence number, or null when it has no `Account` resource yet. `/accounts/{a}`
 * answers a default (`sequence_number: 0`) for an address that does not exist on these nodes, so
 * the resource itself is asked: a 404 is the honest "not created".
 */
async function sequenceAt(api: string, address: string): Promise<bigint | null> {
  const answer = await call(`${api}/accounts/${address}/resource/0x1::account::Account`);
  if (answer.status === 404) return null;
  const body = json(answer, 'the account');
  return u64Of((body.data as { sequence_number?: unknown } | undefined)?.sequence_number, 'sequence_number');
}

/** The coin balance, a bare integer (an account that does not exist answers `0`) — read as its digits, never as a float. */
async function balanceAt(api: string, address: string): Promise<bigint> {
  const answer = await call(`${api}/accounts/${address}/balance/${APTOS_NATIVE_COIN}`);
  if (answer.status < 200 || answer.status > 299) throw new Error(`Move node: the balance answered HTTP ${answer.status}`);
  return u64Of(answer.text.trim(), 'the balance');
}

interface Simulated {
  success: boolean;
  vmStatus: string;
  gasUsed: bigint;
}

async function simulate(api: string, signed: Uint8Array): Promise<Simulated> {
  const answer = await call(`${api}/transactions/simulate`, { method: 'POST', body: signed });
  if (answer.status === 400) {
    // A transaction the node will not even run (a sequence number, a missing account, a gas
    // amount below the floor) comes back as an error body rather than a failed simulation.
    let message = '';
    try {
      message = String((JSON.parse(answer.text) as { message?: unknown; vm_error_code?: unknown }).message ?? '');
    } catch {
      // keep it empty
    }
    return { success: false, vmStatus: message, gasUsed: 0n };
  }
  const body = json(answer, 'the simulation');
  const tx = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  if (!tx || typeof tx.success !== 'boolean' || typeof tx.vm_status !== 'string') throw new Error('Move node: the simulation has no result');
  return { success: tx.success, vmStatus: tx.vm_status, gasUsed: u64Of(tx.gas_used, 'gas_used') };
}

/** Why a simulation failed, as a refusal the screen can name; null for anything else. */
function refusalOf(vmStatus: string, gasBound: 'fee' | 'funds'): 'fee' | 'funds' | 'unfunded' | null {
  // The node writes some statuses as prose ("Out of gas") and others as codes (`INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE`).
  const s = vmStatus.toUpperCase().replace(/\s+/g, '_');
  if (s.includes('INSUFFICIENT_BALANCE')) return 'funds';
  if (s.includes('OUT_OF_GAS') || s.includes('MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS')) return gasBound;
  if (s.includes('SENDING_ACCOUNT_DOES_NOT_EXIST')) return 'unfunded';
  return null;
}

/* ------------------------------------ send ------------------------------------ */

const ZERO_SIGNATURE = new Uint8Array(64);

/**
 * Pay `amount` octas of the coin from our account on Aptos or Movement to `to`. Answers the
 * transaction hash once the node has accepted it for its mempool.
 */
export async function sendAptos(p: FamilyTransfer): Promise<string> {
  const { network, env, def } = p;
  if (!isMoveNetwork(network) || def.balance?.kind !== 'aptos' || !def.send) throw new ChainSwapRefused('chain');
  const chainId = APTOS_CHAIN_ID[network][env];
  // Only the coin: a registry token would be a different payload (a fungible-asset transfer),
  // and neither network lists one, so anything else is not something the screen offered.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  const to = parseAptosAddress(p.to);
  if (!to) throw new ChainSwapRefused('address');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');

  const publicKey = ed25519.getPublicKey(p.secret);
  const owner = aptosAddressOf(publicKey);
  // The key must be the account the screen showed; anything else would sign for someone else's
  // address (and fail the node's authentication-key check after costing a round trip).
  if (owner !== p.owner.toLowerCase()) throw new Error('Move send: the key does not control the owner account');
  const api = def.balance.api;

  // The node is the network the signature is for. The chain id is also inside the signed bytes,
  // so a node that lied here would only relay a transaction its own network rejects.
  const ledger = json(await call(`${api}/`), 'the ledger info');
  if (ledger.chain_id !== chainId) throw new ChainSwapRefused('chain');

  const [sequence, balance, gas] = await Promise.all([
    sequenceAt(api, owner),
    balanceAt(api, owner),
    call(`${api}/estimate_gas_price`).then((a) => json(a, 'the gas price')),
  ]);
  const gasUnitPrice = u64Of(gas.gas_estimate, 'gas_estimate');
  if (gasUnitPrice === 0n) throw new Error('Move node: a gas price of zero');
  // An address nothing was ever sent to has neither an account nor coins to pay with. One with
  // coins but no `Account` resource yet (it only ever received) signs with sequence 0: both
  // networks run the stateless accounts of AIP-115 (asked of their mainnet nodes 2026-10-29: a
  // simulation from such an address is judged on its balance, not refused as missing).
  if (sequence === null && balance === 0n) throw new ChainSwapRefused('unfunded');
  if (balance < p.amount) throw new ChainSwapRefused('funds');

  // The most gas this send may buy: what the fee cap allows, what the balance leaves after the
  // amount, and the protocol's ceiling — whichever is lowest. The simulation runs under it, so a
  // transfer that needs more is known before anything is signed.
  const byFee = p.maxFee / gasUnitPrice;
  const byFunds = (balance - p.amount) / gasUnitPrice;
  const ceiling = [byFee, byFunds, APTOS_MAX_GAS_UNITS].reduce((a, b) => (b < a ? b : a));
  const bound: 'fee' | 'funds' = byFee <= byFunds ? 'fee' : 'funds';
  if (ceiling === 0n) throw new ChainSwapRefused(bound);

  const expirationSecs = BigInt(Math.floor(Date.now() / 1000) + APTOS_TX_EXPIRATION_SECS);
  const fields: AptosTransferFields = {
    sender: hexToBytes(owner.slice(2)),
    sequenceNumber: sequence ?? 0n,
    to,
    amount: p.amount,
    maxGasAmount: ceiling,
    gasUnitPrice,
    expirationSecs,
    chainId,
  };
  const sim = await simulate(api, aptosSignedTx(aptosTransferRaw(fields), publicKey, ZERO_SIGNATURE));
  if (!sim.success) {
    const code = refusalOf(sim.vmStatus, bound);
    if (code) throw new ChainSwapRefused(code);
    throw new Error(`Move node: the transfer would fail (${sim.vmStatus.slice(0, 160)})`);
  }
  // The simulation's gas is the node's word too: one that inflates it is refused, not paid.
  if (sim.gasUsed === 0n || sim.gasUsed > ceiling) throw new ChainSwapRefused(bound);
  const withHeadroom = (sim.gasUsed * APTOS_GAS_HEADROOM_PCT + 99n) / 100n;
  // An account's first transaction (no `Account` resource yet) must offer at least the gas that
  // creating that resource costs — ~521 000 octas on Aptos, ~105 000 on Movement, found by
  // simulation 2026-10-29 — a floor the simulation does not report. It keeps the whole ceiling:
  // gas is paid as used, so the ceiling only bounds the worst case, which is already `maxFee`.
  const maxGasAmount = sequence !== null && withHeadroom < ceiling ? withHeadroom : ceiling;
  // By construction now: gasUsed × price ≤ maxGas × price ≤ maxFee, and amount + maxGas × price ≤ balance.

  const raw = aptosTransferRaw({ ...fields, maxGasAmount });
  const signed = aptosSignedTx(raw, publicKey, ed25519.sign(aptosSigningMessage(raw), p.secret));
  const answer = await call(`${api}/transactions`, { method: 'POST', body: signed });
  if (answer.status !== 202 && answer.status !== 200) {
    let message = '';
    try {
      message = String((JSON.parse(answer.text) as { message?: unknown }).message ?? '');
    } catch {
      // keep it empty
    }
    const code = refusalOf(message, bound);
    if (code) throw new ChainSwapRefused(code);
    throw new Error(`Move node: the transfer was not accepted (HTTP ${answer.status})`);
  }
  return aptosTxHash(signed);
}
