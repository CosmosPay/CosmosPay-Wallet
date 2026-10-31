/**
 * Paying NEAR from the wallet's implicit account (`lib/send/types.ts` is the contract). The
 * account is the hex of the ed25519 public key at m/44'/397'/0' (`lib/chainAddresses.ts`); it
 * exists on chain once something has been sent to it, with that key as its one full-access key.
 *
 * The transfer is a borsh `Transaction` with one `Transfer` action, signed here: the ed25519
 * signature is over sha256 of the borsh bytes, and that hash, in base58, is the transaction's id.
 * The node is asked for state (the key's nonce, a final block hash, the balance, the gas price)
 * and to relay — never to decide:
 *
 * - **The network.** A NEAR transaction names no chain; it is bound to one only by the block hash
 *   it carries, which must be a block of that chain. So the node's `status` must answer the chain
 *   id and genesis hash of `NEAR_CHAIN[env]` before anything is signed, and on the test network
 *   — where the same key controls the same account id on the main one — the main network's node
 *   must NOT know the block hash: a test node handing over a mainnet hash would get a signature
 *   that moves real NEAR.
 * - **The fee.** A NEAR transaction carries no fee: the network charges the gas of its actions at
 *   the block's gas price, the execution part bought up front at `NEAR_MIN_GAS_PURCHASE_PRICE` at
 *   least and refunded after. That up-front cost is the most one send can cost, and is capped by
 *   `maxFee`; the gas amounts are the protocol's (`NEAR_GAS`), only the price is the node's word.
 * - **The funds.** The amount plus that cost must fit the liquid balance, and an account past the
 *   zero-balance storage limit keeps what its storage needs; otherwise `funds`, before signing.
 *
 * Recipients: an implicit account (64 hex), an ETH-implicit one (NEP-518, `0x` + 40 hex — both
 * created by the transfer itself, which costs `createAccount` gas), or a named account, which a
 * transfer cannot create: one that does not exist is refused as an address before signing.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  NEAR_CHAIN,
  NEAR_GAS,
  NEAR_MIN_GAS_PURCHASE_PRICE,
  NEAR_REPLAY_SETTLE_MS,
  NEAR_SEND_TIMEOUT_MS,
  NEAR_SEND_WAIT_UNTIL,
  NEAR_STORAGE_PRICE_PER_BYTE,
  NEAR_ZERO_BALANCE_STORAGE_LIMIT,
} from '@/constants/nearSend';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* -------------------------------- account ids -------------------------------- */

/** How the protocol treats a recipient: it prices (and creates) an account by this type. */
export type NearAccountKind = 'implicit' | 'eth' | 'named';

export interface NearAccount {
  /** The account id as the chain spells it (hex forms lowercased). */
  id: string;
  kind: NearAccountKind;
}

const IMPLICIT_RE = /^[0-9a-fA-F]{64}$/;
const ETH_IMPLICIT_RE = /^0x[0-9a-fA-F]{40}$/;
/** nearcore's account-id grammar: lowercase parts joined by `-`/`_`, levels by `.`; 2–64 chars. */
const NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
/** NEP-616's deterministic (`0s…`) and the universal (`0u…`) accounts: made by a state init, never by a plain transfer. */
const STATE_INIT_ACCOUNT_RE = /^0[su][0-9a-z]+$/;
/** A hex address cut or padded in a copy (`0x1234`, 62 hex digits): valid name syntax, never what was meant. */
const BROKEN_HEX_RE = /^(0x[0-9a-z]*|[0-9a-f]{32,})$/;

/**
 * The recipient `text` names in `env`, or null. Hex is case-free (a pasted, checksummed 0x
 * address is the same account), a name is not. A name of the other network's registrar
 * (`.testnet` on the main network, anything else on the test one) is refused: it is a typo or a
 * copy from the wrong place, and a transfer there would only bounce.
 */
export function parseNearAccount(text: string, env: ChainNet): NearAccount | null {
  if (IMPLICIT_RE.test(text)) return { id: text.toLowerCase(), kind: 'implicit' };
  if (ETH_IMPLICIT_RE.test(text)) return { id: text.toLowerCase(), kind: 'eth' };
  if (text.length < 2 || text.length > 64 || !NAMED_RE.test(text) || STATE_INIT_ACCOUNT_RE.test(text) || BROKEN_HEX_RE.test(text)) return null;
  const testName = text === 'testnet' || text.endsWith('.testnet');
  return (env === 'testnet') === testName ? { id: text, kind: 'named' } : null;
}

/** Whether `address` is an account the wallet pays on `network` in `env` — the predicate the screen and the signer share. */
export function isNearAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  return NETWORKS[network].address === 'near' && parseNearAccount(address, env) !== null;
}

/* ----------------------------------- borsh ----------------------------------- */

function uint(value: bigint, bytes: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) throw new Error(`NEAR: integer out of range for ${bytes * 8} bits`);
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const u32 = (n: number) => uint(BigInt(n), 4);
const borshString = (s: string) => {
  const bytes = utf8ToBytes(s);
  return concatBytes(u32(bytes.length), bytes);
};

/** `PublicKey::ED25519` is key type 0 followed by the 32 bytes; a signature is the same tag and 64 bytes. */
const ED25519_KEY_TYPE = 0;
/** `Action::Transfer`'s index in nearcore's `Action` enum (CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3). */
const ACTION_TRANSFER = 3;

export interface NearTransferTx {
  signerId: string;
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  /** yoctoNEAR. */
  deposit: bigint;
}

/** The borsh bytes of a `Transaction` (V0) carrying one `Transfer`. */
export function nearTransferTx(t: NearTransferTx): Uint8Array {
  if (t.publicKey.length !== 32 || t.blockHash.length !== 32) throw new Error('NEAR: a key and a block hash are 32 bytes');
  return concatBytes(
    borshString(t.signerId),
    Uint8Array.of(ED25519_KEY_TYPE),
    t.publicKey,
    uint(t.nonce, 8),
    borshString(t.receiverId),
    t.blockHash,
    u32(1),
    Uint8Array.of(ACTION_TRANSFER),
    uint(t.deposit, 16),
  );
}

/**
 * Sign the transaction bytes: ed25519 over sha256(tx). Answers the `SignedTransaction` (the tx,
 * then the signature with its key type) and the transaction's id, base58 of that same hash.
 */
export function signNearTx(tx: Uint8Array, seed: Uint8Array): { signed: Uint8Array; hash: string } {
  const digest = sha256(tx);
  const signature = ed25519.sign(digest, seed);
  return { signed: concatBytes(tx, Uint8Array.of(ED25519_KEY_TYPE), signature), hash: base58.encode(digest) };
}

/* ------------------------------------ fee ------------------------------------ */

/**
 * The gas a transfer to an account of `kind` burns when it becomes a receipt (`send`) and when
 * that receipt runs (`exec`). An ed25519 key's signature costs no gas; only ML-DSA keys pay one.
 */
export function nearTransferGas(kind: NearAccountKind): { send: bigint; exec: bigint } {
  const g = NEAR_GAS;
  const create = kind === 'implicit' ? [g.createAccount, g.addFullAccessKey] : kind === 'eth' ? [g.createAccount] : [];
  return {
    send: g.receipt.send + g.transfer.send + create.reduce((s, f) => s + f.send, 0n),
    exec: g.receipt.exec + g.transfer.exec + create.reduce((s, f) => s + f.exec, 0n),
  };
}

/**
 * The most a transfer to an account of `kind` can cost at `gasPrice` (yoctoNEAR per gas): its
 * send gas burnt at that price, its execution gas bought at `NEAR_MIN_GAS_PURCHASE_PRICE` at least
 * (nearcore's `calculate_tx_cost`).
 */
export function nearTransferCost(kind: NearAccountKind, gasPrice: bigint): bigint {
  const gas = nearTransferGas(kind);
  const purchasePrice = gasPrice > NEAR_MIN_GAS_PURCHASE_PRICE ? gasPrice : NEAR_MIN_GAS_PURCHASE_PRICE;
  return gas.send * gasPrice + gas.exec * purchasePrice;
}

/* ------------------------------------ rpc ------------------------------------ */

interface RpcEnvelope {
  result?: unknown;
  error?: unknown;
}

let nextId = 1;

/** One JSON-RPC call. A transport failure throws; a node's own error comes back in the envelope for the caller to read. */
async function nearRpc(url: string, method: string, params: unknown, timeoutMs: number = CHAIN_RPC_TIMEOUT_MS): Promise<RpcEnvelope> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`NEAR ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as RpcEnvelope;
    if (!body || typeof body !== 'object') throw new Error(`NEAR ${method}: not a JSON-RPC answer`);
    return body;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`NEAR ${method}: timed out`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The name of a node's error: `cause.name` (`UNKNOWN_ACCOUNT`, `INVALID_TRANSACTION`…), else the error's own. */
function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { name?: unknown; cause?: { name?: unknown } };
  const name = e.cause?.name ?? e.name;
  return typeof name === 'string' ? name : undefined;
}

const record = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`NEAR ${what}: unexpected answer`);
  return v as Record<string, unknown>;
};

/** A non-negative integer the node wrote as a string of digits (balances, gas price). */
function digits(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error(`NEAR ${what}: unexpected answer`);
  return BigInt(v);
}

/** A non-negative integer the node wrote as a JSON number (nonce, storage usage); past 2^53 it would already be rounded. */
function safeInt(v: unknown, what: string): bigint {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error(`NEAR ${what}: unexpected answer`);
  return BigInt(v);
}

function blockHashBytes(v: unknown, what: string): Uint8Array {
  let bytes: Uint8Array | null = null;
  try {
    bytes = typeof v === 'string' ? base58.decode(v) : null;
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length !== 32) throw new Error(`NEAR ${what}: unexpected answer`);
  return bytes;
}

const ACCOUNT_MISSING = new Set(['UNKNOWN_ACCOUNT', 'UNKNOWN_ACCESS_KEY']);

/* ----------------------------------- send ------------------------------------ */

/**
 * Pay `amount` yoctoNEAR from our implicit account to `to`. Answers the transaction id once the
 * node has run it. `settleMs` is the test network's replay wait (`NEAR_REPLAY_SETTLE_MS`); only a
 * test shortens it.
 */
export async function sendNear(p: FamilyTransfer, settleMs: number = NEAR_REPLAY_SETTLE_MS): Promise<string> {
  const source = p.def.balance;
  if (NETWORKS[p.network].address !== 'near' || source?.kind !== 'near') throw new ChainSwapRefused('chain');
  // NEAR's tokens (NEP-141) are contract calls, not transfers: only the coin is paid here.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  // A transfer action has nowhere to carry a memo; a deposit that needs one is not paid without it.
  if ((p.memo?.trim() ?? '') !== '') throw new ChainSwapRefused('memo');
  const to = parseNearAccount(p.to, p.env);
  if (!to) throw new ChainSwapRefused('address');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  if (p.amount >= 1n << 128n) throw new ChainSwapRefused('funds');

  const publicKey = ed25519.getPublicKey(p.secret);
  const owner = bytesToHex(publicKey);
  if (p.owner !== owner) throw new Error('The NEAR key does not control the account it would sign for');
  const rpc = source.rpc;

  // The node must be the network the block hash will bind the signature to.
  const status = await nearRpc(rpc, 'status', []);
  const chain = status.result && typeof status.result === 'object' ? (status.result as { chain_id?: unknown; genesis_hash?: unknown }) : {};
  if (chain.chain_id !== NEAR_CHAIN[p.env].chainId || chain.genesis_hash !== NEAR_CHAIN[p.env].genesisHash) throw new ChainSwapRefused('chain');

  // The key's nonce as of the latest block, so a send right after another does not reuse it.
  const key = await nearRpc(rpc, 'query', {
    request_type: 'view_access_key',
    finality: 'optimistic',
    account_id: owner,
    public_key: `ed25519:${base58.encode(publicKey)}`,
  });
  // An account never funded has no key; older nodes answer a missing key as a result with an
  // `error` string rather than as an error.
  if (ACCOUNT_MISSING.has(errorName(key.error) ?? '')) throw new ChainSwapRefused('unfunded');
  if (key.error !== undefined) throw new Error('NEAR view_access_key failed');
  const access = record(key.result, 'view_access_key');
  if (typeof access.error === 'string') throw new ChainSwapRefused('unfunded');
  // A function-call key cannot sign a transfer; the implicit account's own key is full access.
  if (access.permission !== 'FullAccess') throw new Error('The NEAR key of this account cannot sign transfers');
  const nonce = safeInt(access.nonce, 'view_access_key') + 1n;

  const recipientKnown = async (): Promise<void> => {
    if (to.kind !== 'named') return;
    const r = await nearRpc(rpc, 'query', { request_type: 'view_account', finality: 'final', account_id: to.id });
    if (errorName(r.error) === 'UNKNOWN_ACCOUNT') throw new ChainSwapRefused('address');
    if (r.error !== undefined) throw new Error('NEAR view_account failed');
  };
  const [block, account, price] = await Promise.all([
    nearRpc(rpc, 'block', { finality: 'final' }),
    nearRpc(rpc, 'query', { request_type: 'view_account', finality: 'optimistic', account_id: owner }),
    nearRpc(rpc, 'gas_price', [null]),
    recipientKnown(),
  ]);
  if (block.error !== undefined) throw new Error('NEAR block failed');
  const blockHash = blockHashBytes(record(record(block.result, 'block').header, 'block').hash, 'block');
  if (errorName(account.error) === 'UNKNOWN_ACCOUNT') throw new ChainSwapRefused('unfunded');
  if (account.error !== undefined) throw new Error('NEAR view_account failed');
  const state = record(account.result, 'view_account');
  if (price.error !== undefined) throw new Error('NEAR gas_price failed');
  const gasPrice = digits(record(price.result, 'gas_price').gas_price, 'gas_price');

  // The gas price is the node's word; whatever it says, one send never costs more than maxFee.
  const cost = nearTransferCost(to.kind, gasPrice);
  if (cost > p.maxFee) throw new ChainSwapRefused('fee');

  // The node refuses a transaction whose up-front cost (deposit + gas bought) is above the
  // liquid balance, or that leaves an account past the zero-balance limit short of its storage.
  const liquid = digits(state.amount, 'view_account');
  const locked = digits(state.locked, 'view_account');
  const storage = safeInt(state.storage_usage, 'view_account');
  const total = p.amount + cost;
  if (total > liquid) throw new ChainSwapRefused('funds');
  if (storage > NEAR_ZERO_BALANCE_STORAGE_LIMIT && liquid - total + locked < storage * NEAR_STORAGE_PRICE_PER_BYTE) throw new ChainSwapRefused('funds');

  if (p.env !== 'mainnet') {
    // The same key is the same account on the main network: the hash must be one only the test
    // network knows. Asked AFTER `settleMs`, so a mainnet block too fresh for the main node to
    // have seen is seen by then; any answer but "unknown block" (or none) is a refusal.
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    const main = NETWORKS.near.balance;
    if (main?.kind !== 'near') throw new ChainSwapRefused('chain');
    let known: string | undefined;
    try {
      known = errorName((await nearRpc(main.rpc, 'block', { block_id: base58.encode(blockHash) })).error);
    } catch {
      known = undefined;
    }
    if (known !== 'UNKNOWN_BLOCK') throw new ChainSwapRefused('chain');
  }

  const tx = nearTransferTx({ signerId: owner, publicKey, nonce, receiverId: to.id, blockHash, deposit: p.amount });
  const { signed, hash } = signNearTx(tx, p.secret);
  const sent = await nearRpc(rpc, 'send_tx', { signed_tx_base64: base64.encode(signed), wait_until: NEAR_SEND_WAIT_UNTIL }, NEAR_SEND_TIMEOUT_MS);
  if (sent.error !== undefined) {
    const name = errorName(sent.error);
    // The node accepted the transaction and stopped waiting for it: it is on its way.
    if (name === 'TIMEOUT_ERROR') return hash;
    const detail = JSON.stringify(sent.error);
    if (/NotEnoughBalance|LackBalanceForState/.test(detail)) throw new ChainSwapRefused('funds');
    throw new Error(`NEAR send_tx refused the transfer (${name ?? 'unknown error'})`);
  }
  const executed = record(sent.result, 'send_tx').status;
  if (executed && typeof executed === 'object' && 'Failure' in executed) throw new Error('The NEAR transfer failed on chain');
  return hash;
}
