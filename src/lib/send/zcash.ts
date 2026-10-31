/**
 * Paying ZEC from the wallet's transparent address (`t1…`, `m/44'/133'/0'/0/0`): a version 5
 * transaction (ZIP-225) with transparent inputs and outputs only, every input signed over the
 * ZIP-244 signature digest with SIGHASH_ALL. The wallet holds no shielded keys, so it neither
 * spends from nor pays to a shielded pool; what it pays to is a transparent address (`t1…`
 * P2PKH, `t3…` P2SH) or ZIP-320's TEX form of a P2PKH (`tex1…`), which asks exactly for a
 * transaction spending transparent coins only — the only kind this builds.
 *
 * What keeps the public services from deciding anything:
 * - **The node is Zcash Mainnet at the upgrade the table knows.** Its genesis hash, its chain name,
 *   and its `consensus.nextblock` — the branch id the next block is validated under — must agree
 *   with `ZCASH_UPGRADES` before anything is signed. The branch id is inside the signed digest
 *   and the transaction, so the signature is worthless on any other chain and any other epoch.
 * - **The fee is ZIP-317's and capped.** It is counted from the inputs and outputs, never asked
 *   of anyone, and a send whose fee is above `maxFee` is refused.
 * - **The coin list cannot move the fee.** A v5 signature commits to the amount and script of
 *   every coin spent, so a list that lies about one makes a transaction no node accepts, never
 *   one that pays a different fee than the one counted here.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32m, createBase58check } from '@scure/base';
import type { ChainNet } from '@/constants/chains';
import type { NetworkId } from '@/constants/networks';
import {
  ZCASH_BLOCKCHAIR_API,
  ZCASH_CHAIN_NAME,
  ZCASH_COINBASE_MATURITY,
  ZCASH_DUST_RATE_PER_KB,
  ZCASH_EXPIRING_SOON_THRESHOLD,
  ZCASH_GENESIS_HASH,
  ZCASH_INSIGHT_API,
  ZCASH_MAX_INPUTS,
  ZCASH_NODE_RPC,
  ZCASH_P2PKH_INPUT_MAX_SIZE,
  ZCASH_REQUEST_TIMEOUT_MS,
  ZCASH_SEQUENCE,
  ZCASH_TEX_HRP,
  ZCASH_UPGRADES,
  ZCASH_V5_HEADER,
  ZCASH_V5_VERSION_GROUP_ID,
  ZEC_P2SH_VERSION,
  ZIP317_GRACE_ACTIONS,
  ZIP317_MARGINAL_FEE,
  ZIP317_P2PKH_STANDARD_INPUT_SIZE,
  ZIP317_P2PKH_STANDARD_OUTPUT_SIZE,
} from '@/constants/zcashSend';
import { hash160, p2pkhAddress, ZEC_P2PKH_VERSION } from '@/lib/addresses/utxo';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

const base58check = createBase58check(sha256);

/* ------------------------------------------------------------------ addresses */

/** A transparent destination: the 20-byte hash its script locks to. */
interface Destination {
  kind: 'p2pkh' | 'p2sh';
  hash: Uint8Array;
}

const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((x, i) => x === b[i]);

/**
 * The transparent destination `address` names on Mainnet, or null. Shielded addresses (`zs…`
 * Sapling, `u1…` unified) are not destinations here: the wallet has no shielded keys and builds
 * no shielded outputs, and a unified address's transparent receiver is not read out of it,
 * since its owner chose to be paid shielded first.
 */
function destination(address: string): Destination | null {
  if (/^tex1/i.test(address)) {
    try {
      const { prefix, words } = bech32m.decode(address as `${string}1${string}`);
      const hash = bech32m.fromWords(words);
      return prefix === ZCASH_TEX_HRP && hash.length === 20 ? { kind: 'p2pkh', hash } : null;
    } catch {
      return null;
    }
  }
  let raw: Uint8Array;
  try {
    raw = base58check.decode(address);
  } catch {
    return null;
  }
  if (raw.length !== 22) return null;
  const version = raw.subarray(0, 2);
  if (sameBytes(version, ZEC_P2PKH_VERSION)) return { kind: 'p2pkh', hash: raw.slice(2) };
  if (sameBytes(version, ZEC_P2SH_VERSION)) return { kind: 'p2sh', hash: raw.slice(2) };
  return null;
}

/**
 * Whether `address` is a recipient a Zcash send pays in `env`: a Mainnet transparent address
 * (`t1…`, `t3…`) or a TEX address (`tex1…`), checksum verified. The wallet has no Zcash test
 * network, so nothing is one in test mode.
 */
export function isZcashAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  return network === 'zec' && env === 'mainnet' && destination(address) !== null;
}

const p2pkhScript = (hash: Uint8Array) => concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), hash, Uint8Array.of(0x88, 0xac));
const p2shScript = (hash: Uint8Array) => concatBytes(Uint8Array.of(0xa9, 0x14), hash, Uint8Array.of(0x87));

/** The scriptPubKey paying `address`, or null when it is no Mainnet transparent recipient. */
export function zcashOutputScript(address: string): Uint8Array | null {
  const dest = destination(address);
  return dest ? (dest.kind === 'p2pkh' ? p2pkhScript(dest.hash) : p2shScript(dest.hash)) : null;
}

/* -------------------------------------------------------------- serialization */

/** One spent coin's outpoint; `txid` in the byte order the wire carries (the reverse of its hex). */
export interface ZcashOutPoint {
  txid: Uint8Array;
  index: number;
}
export interface ZcashInput extends ZcashOutPoint {
  scriptSig: Uint8Array;
  sequence: number;
}
export interface ZcashOutput {
  /** Zatoshis. */
  value: bigint;
  script: Uint8Array;
}
/** A v5 transaction with transparent parts only: what this sender writes. */
export interface ZcashTransparentTx {
  branchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: ZcashInput[];
  outputs: ZcashOutput[];
}
/** What an input spends — the coin's amount and script, which ZIP-244 signs over. */
export interface ZcashSpentCoin {
  value: bigint;
  script: Uint8Array;
}

const u32le = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
};
const i64le = (n: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, n, true);
  return out;
};

/** Bitcoin's CompactSize length prefix. */
function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >>> 8);
  return concatBytes(Uint8Array.of(0xfe), u32le(n));
}
const withLength = (bytes: Uint8Array) => concatBytes(compactSize(bytes.length), bytes);

const outpointBytes = (o: ZcashOutPoint) => concatBytes(o.txid, u32le(o.index));
const outputBytes = (o: ZcashOutput) => concatBytes(i64le(o.value), withLength(o.script));

function headerBytes(tx: ZcashTransparentTx): Uint8Array {
  return concatBytes(u32le(ZCASH_V5_HEADER), u32le(ZCASH_V5_VERSION_GROUP_ID), u32le(tx.branchId), u32le(tx.lockTime), u32le(tx.expiryHeight));
}

/**
 * The transaction as the network carries it (ZIP-225): the header fields, the transparent
 * bundle as Bitcoin writes it, then zero Sapling spends, zero Sapling outputs and zero Orchard
 * actions — each an empty bundle is a single 0x00 count and nothing after it.
 */
export function encodeZcashV5(tx: ZcashTransparentTx): Uint8Array {
  return concatBytes(
    headerBytes(tx),
    compactSize(tx.inputs.length),
    ...tx.inputs.map((i) => concatBytes(outpointBytes(i), withLength(i.scriptSig), u32le(i.sequence))),
    compactSize(tx.outputs.length),
    ...tx.outputs.map(outputBytes),
    Uint8Array.of(0x00, 0x00, 0x00),
  );
}

/* -------------------------------------------------------------------- digests */

/** BLAKE2b-256 under one of ZIP-244's 16-byte personalizations. */
const digest = (personalization: string | Uint8Array, ...parts: Uint8Array[]) =>
  blake2b(concatBytes(...parts), {
    dkLen: 32,
    personalization: typeof personalization === 'string' ? utf8ToBytes(personalization) : personalization,
  });

/** The digests of the shielded bundles; this wallet's transactions have none. */
export interface ZcashBundleDigests {
  sapling: Uint8Array;
  orchard: Uint8Array;
}
const EMPTY_BUNDLES: ZcashBundleDigests = {
  sapling: digest('ZTxIdSaplingHash'),
  orchard: digest('ZTxIdOrchardHash'),
};

/** T.2a–T.2c: shared by the transaction id and the signature digest under SIGHASH_ALL. */
function transparentParts(tx: ZcashTransparentTx) {
  return {
    prevouts: digest('ZTxIdPrevoutHash', ...tx.inputs.map(outpointBytes)),
    sequence: digest('ZTxIdSequencHash', ...tx.inputs.map((i) => u32le(i.sequence))),
    outputs: digest('ZTxIdOutputsHash', ...tx.outputs.map(outputBytes)),
  };
}

/** The tree's root: personalized with the branch id, which is what binds a signature to an epoch. */
function rootDigest(tx: ZcashTransparentTx, transparent: Uint8Array, bundles: ZcashBundleDigests): Uint8Array {
  const personalization = concatBytes(utf8ToBytes('ZcashTxHash_'), u32le(tx.branchId));
  return digest(personalization, digest('ZTxIdHeadersHash', headerBytes(tx)), transparent, bundles.sapling, bundles.orchard);
}

/**
 * ZIP-244's transaction id digest (wire byte order). `bundles` defaults to the empty Sapling and
 * Orchard bundles of every transaction this wallet builds; it is a parameter so that the published
 * test vectors, which carry shielded bundles, pin the rest of the tree.
 */
export function zcashTxidDigest(tx: ZcashTransparentTx, bundles: ZcashBundleDigests = EMPTY_BUNDLES): Uint8Array {
  const t = transparentParts(tx);
  const transparent =
    tx.inputs.length + tx.outputs.length === 0 ? digest('ZTxIdTranspaHash') : digest('ZTxIdTranspaHash', t.prevouts, t.sequence, t.outputs);
  return rootDigest(tx, transparent, bundles);
}

/** The transaction id as explorers and nodes print it: the digest's bytes reversed, in hex. */
export const zcashTxid = (tx: ZcashTransparentTx): string => bytesToHex(zcashTxidDigest(tx).slice().reverse());

const SIGHASH_ALL = 0x01;

/**
 * ZIP-244's signature digest of transparent input `index` under SIGHASH_ALL — the only hash type
 * this wallet signs with: it commits to every input, every output, and (S.2c, S.2d) the amount and
 * script of every coin spent, in `spent` order. scriptSigs are not part of it, so every input of
 * one transaction is signed over the same unsigned skeleton.
 */
export function zcashSignatureDigest(
  tx: ZcashTransparentTx,
  index: number,
  spent: readonly ZcashSpentCoin[],
  bundles: ZcashBundleDigests = EMPTY_BUNDLES,
): Uint8Array {
  const input = tx.inputs[index];
  if (!input || spent.length !== tx.inputs.length) throw new Error('Zcash signature digest: one spent coin per input is required');
  const t = transparentParts(tx);
  const transparent = digest(
    'ZTxIdTranspaHash',
    Uint8Array.of(SIGHASH_ALL),
    t.prevouts,
    digest('ZTxTrAmountsHash', ...spent.map((c) => i64le(c.value))),
    digest('ZTxTrScriptsHash', ...spent.map((c) => withLength(c.script))),
    t.sequence,
    t.outputs,
    digest('Zcash___TxInHash', outpointBytes(input), i64le(spent[index].value), withLength(spent[index].script), u32le(input.sequence)),
  );
  return rootDigest(tx, transparent, bundles);
}

/* ----------------------------------------------------------------- fee, dust */

const outputSize = (script: Uint8Array) => 8 + compactSize(script.length).length + script.length;
const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

/**
 * ZIP-317's conventional fee for `inputs` signed P2PKH inputs (each counted at its largest,
 * `ZCASH_P2PKH_INPUT_MAX_SIZE`) and outputs to `outputScripts`. No shielded bundle, so the
 * logical actions are the transparent ones alone.
 */
export function zip317Fee(inputs: number, outputScripts: readonly Uint8Array[]): bigint {
  const inBytes = inputs * ZCASH_P2PKH_INPUT_MAX_SIZE;
  const outBytes = outputScripts.reduce((sum, s) => sum + outputSize(s), 0);
  const actions = Math.max(ceilDiv(inBytes, ZIP317_P2PKH_STANDARD_INPUT_SIZE), ceilDiv(outBytes, ZIP317_P2PKH_STANDARD_OUTPUT_SIZE));
  return ZIP317_MARGINAL_FEE * BigInt(Math.max(ZIP317_GRACE_ACTIONS, actions));
}

/** The smallest output to `script` a node relays (54 zatoshis for P2PKH and P2SH). */
export function zcashDustThreshold(script: Uint8Array): bigint {
  return 3n * ((BigInt(ZCASH_DUST_RATE_PER_KB) * BigInt(outputSize(script) + ZCASH_P2PKH_INPUT_MAX_SIZE)) / 1000n);
}

/* ------------------------------------------------------------- epoch, expiry */

/** A network upgrade as the node lists it (`getblockchaininfo.upgrades`). */
export interface ZcashScheduledUpgrade {
  branchId: number;
  height: number;
}

/**
 * The branch id and expiry height for a transaction built on a node at `tip`, or null when it
 * must not be signed: the node validates the next block under another branch than this table's
 * (an upgrade the table lacks, or a node on another chain), it lists an upgrade active by then
 * that the table does not know, or an upgrade is so close that no expiry before it would be
 * relayed. The expiry is the default delta from the target height (ZIP-203, ZIP-218), cut to
 * the block before the next activation either side knows of — past it the branch id is wrong
 * and the transaction could never be mined, so it should not linger in mempools until then.
 */
export function zcashSendWindow(
  tip: number,
  nextBlockBranch: number,
  scheduled: readonly ZcashScheduledUpgrade[],
): { branchId: number; expiryHeight: number } | null {
  const target = tip + 1;
  const active = [...ZCASH_UPGRADES].reverse().find((u) => u.height <= target);
  if (!active || active.branchId !== nextBlockBranch) return null;
  const known = new Set(ZCASH_UPGRADES.map((u) => u.branchId));
  if (scheduled.some((u) => u.height >= ZCASH_UPGRADES[0].height && u.height <= target && !known.has(u.branchId))) return null;
  const nextActivation = Math.min(...[...ZCASH_UPGRADES, ...scheduled].map((u) => u.height).filter((h) => h > target), Infinity);
  const expiryHeight = Math.min(target + active.expiryDelta, nextActivation - 1);
  if (expiryHeight < target + ZCASH_EXPIRING_SOON_THRESHOLD) return null;
  return { branchId: active.branchId, expiryHeight };
}

/* ------------------------------------------------------------ coin selection */

/** One unspent output of our address; `txid` as explorers print it. */
export interface ZcashCoin {
  txid: string;
  index: number;
  value: bigint;
  /** Mined (false: still in the mempool). */
  confirmed: boolean;
}

export interface ZcashPlan {
  inputs: ZcashCoin[];
  outputs: ZcashOutput[];
  /** What the transaction leaves to the miner: inputs less outputs. */
  fee: bigint;
}

/**
 * Which coins pay `amount` to `to`, with the change back to `change`: mined coins before
 * mempool ones, largest first, so a send spends as few inputs (each one a ZIP-317 action) as it
 * can. Change below the dust threshold is left to the miner rather than written as an output no
 * node would relay. Refuses 'fee' when the fee that takes is above `maxFee` (or the coins it
 * takes are more than one transaction holds), 'funds' when the coins do not cover it.
 */
export function planZcashSend(coins: readonly ZcashCoin[], amount: bigint, to: Uint8Array, change: Uint8Array, maxFee: bigint): ZcashPlan {
  const ordered = [...coins].sort(
    (a, b) =>
      Number(b.confirmed) - Number(a.confirmed) ||
      (a.value === b.value ? 0 : a.value > b.value ? -1 : 1) ||
      a.txid.localeCompare(b.txid) ||
      a.index - b.index,
  );
  const inputs: ZcashCoin[] = [];
  let sum = 0n;
  for (const coin of ordered) {
    if (inputs.length === ZCASH_MAX_INPUTS) break;
    inputs.push(coin);
    sum += coin.value;
    const fee = zip317Fee(inputs.length, [to, change]);
    if (sum < amount + fee) continue;
    const rest = sum - amount - fee;
    const plan: ZcashPlan =
      rest >= zcashDustThreshold(change)
        ? { inputs, outputs: [{ value: amount, script: to }, { value: rest, script: change }], fee }
        : { inputs, outputs: [{ value: amount, script: to }], fee: sum - amount };
    if (plan.fee > maxFee) throw new ChainSwapRefused('fee');
    return plan;
  }
  const total = ordered.reduce((s, c) => s + c.value, 0n);
  if (ordered.length > ZCASH_MAX_INPUTS && total >= amount + zip317Fee(ordered.length, [to, change])) throw new ChainSwapRefused('fee');
  throw new ChainSwapRefused('funds');
}

/* -------------------------------------------------------------------- signing */

/**
 * Sign `plan` with `secret` (the 32-byte secp256k1 scalar of our P2PKH address): one low-S DER
 * signature per input over its ZIP-244 digest, SIGHASH_ALL, and the compressed key — the
 * scriptSig a P2PKH coin is spent with. Answers the wire bytes and the transaction id.
 */
export function signZcashTransfer(
  plan: ZcashPlan,
  secret: Uint8Array,
  window: { branchId: number; expiryHeight: number },
): { raw: Uint8Array; txid: string } {
  const publicKey = secp256k1.getPublicKey(secret, true);
  const own = p2pkhScript(hash160(publicKey));
  const tx: ZcashTransparentTx = {
    branchId: window.branchId,
    lockTime: 0,
    expiryHeight: window.expiryHeight,
    inputs: plan.inputs.map((c) => ({ txid: hexToBytes(c.txid).reverse(), index: c.index, scriptSig: new Uint8Array(0), sequence: ZCASH_SEQUENCE })),
    outputs: plan.outputs,
  };
  const spent = plan.inputs.map((c) => ({ value: c.value, script: own }));
  const scriptSigs = tx.inputs.map((_, i) => {
    const sig = secp256k1.sign(zcashSignatureDigest(tx, i, spent), secret, { prehash: false, lowS: true, format: 'der' });
    return concatBytes(Uint8Array.of(sig.length + 1), sig, Uint8Array.of(SIGHASH_ALL), Uint8Array.of(publicKey.length), publicKey);
  });
  const signed: ZcashTransparentTx = { ...tx, inputs: tx.inputs.map((input, i) => ({ ...input, scriptSig: scriptSigs[i] })) };
  return { raw: encodeZcashV5(signed), txid: zcashTxid(signed) };
}

/* ------------------------------------------------------------------------ I/O */

async function fetchJson(label: string, url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ZCASH_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON (an HTML error page): the status says what happened.
    }
    return { status: res.status, body };
  } catch (e) {
    throw new Error(`${label}: ${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function nodeCall(method: string, params: unknown[]): Promise<unknown> {
  const label = `Zcash node ${method}`;
  const { status, body } = await fetchJson(label, ZCASH_NODE_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (isObject(body) && isObject(body.error)) throw new Error(`${label}: ${String(body.error.message ?? 'error').slice(0, 200)}`);
  if (status === 429) throw new Error(`${label}: rate limited`);
  if (status !== 200 || !isObject(body) || !('result' in body)) throw new Error(`${label}: HTTP ${status}`);
  return body.result;
}

const isHeight = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const branchHex = (v: unknown): number | null => (typeof v === 'string' && /^[0-9a-f]{8}$/i.test(v) ? parseInt(v, 16) : null);

/** `getblockchaininfo`, read down to what the window needs; a field missing is a node not to sign for. */
async function chainState(): Promise<{ chain: string; tip: number; nextBlockBranch: number; scheduled: ZcashScheduledUpgrade[] }> {
  const info = await nodeCall('getblockchaininfo', []);
  const consensus = isObject(info) ? info.consensus : null;
  const upgrades = isObject(info) ? info.upgrades : null;
  const nextBlockBranch = isObject(consensus) ? branchHex(consensus.nextblock) : null;
  if (!isObject(info) || typeof info.chain !== 'string' || !isHeight(info.blocks) || nextBlockBranch === null || !isObject(upgrades)) {
    throw new Error('Zcash node getblockchaininfo: unexpected answer');
  }
  const scheduled: ZcashScheduledUpgrade[] = [];
  for (const [id, u] of Object.entries(upgrades)) {
    const branchId = branchHex(id);
    if (branchId === null || !isObject(u) || !isHeight(u.activationheight)) throw new Error('Zcash node getblockchaininfo: unexpected upgrade');
    scheduled.push({ branchId, height: u.activationheight });
  }
  return { chain: info.chain, tip: info.blocks, nextBlockBranch, scheduled };
}

const TXID = /^[0-9a-f]{64}$/i;
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const zats = (v: unknown): bigint | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? BigInt(v) : null);

/** Blockchair's address dashboard: `data[address].utxo`, `block_id` -1 for a mempool coin. */
async function blockchairCoins(address: string): Promise<ZcashCoin[]> {
  const { status, body } = await fetchJson('Blockchair', `${ZCASH_BLOCKCHAIR_API}/dashboards/address/${encodeURIComponent(address)}`);
  // 430 is Blockchair's per-IP blacklist: a rate limit, like a 429.
  if (status === 429 || status === 430) throw new Error('Blockchair: rate limited');
  const data = isObject(body) ? body.data : null;
  const keys = isObject(data) ? Object.keys(data) : [];
  const entry = isObject(data) ? (address in data ? data[address] : keys.length === 1 ? data[keys[0]] : null) : null;
  if (status !== 200 || !isObject(entry) || !Array.isArray(entry.utxo)) throw new Error(`Blockchair: unexpected answer (HTTP ${status})`);
  return entry.utxo.map((u: unknown) => {
    const value = isObject(u) ? zats(u.value) : null;
    if (!isObject(u) || typeof u.transaction_hash !== 'string' || !TXID.test(u.transaction_hash) || !isIndex(u.index) || value === null || typeof u.block_id !== 'number') {
      throw new Error('Blockchair: unexpected coin');
    }
    return { txid: u.transaction_hash.toLowerCase(), index: u.index, value, confirmed: u.block_id >= 0 };
  });
}

/** Insight's `/addr/{a}/utxo`. It flags coinbase outputs, which are held back until mature. */
async function insightCoins(address: string): Promise<ZcashCoin[]> {
  const { status, body } = await fetchJson('Insight', `${ZCASH_INSIGHT_API}/addr/${encodeURIComponent(address)}/utxo`);
  if (status === 429) throw new Error('Insight: rate limited');
  if (status !== 200 || !Array.isArray(body)) throw new Error(`Insight: unexpected answer (HTTP ${status})`);
  const coins: ZcashCoin[] = [];
  for (const u of body) {
    const value = isObject(u) ? zats(u.satoshis) : null;
    if (!isObject(u) || typeof u.txid !== 'string' || !TXID.test(u.txid) || !isIndex(u.vout) || value === null) throw new Error('Insight: unexpected coin');
    if (u.address !== undefined && u.address !== address) throw new Error('Insight: a coin of another address');
    const confirmations = isHeight(u.confirmations) ? u.confirmations : 0;
    if (u.coinbase === true && confirmations < ZCASH_COINBASE_MATURITY) continue;
    coins.push({ txid: u.txid.toLowerCase(), index: u.vout, value, confirmed: confirmations > 0 });
  }
  return coins;
}

/**
 * Our address's coins: Blockchair's list, or Insight's when Blockchair refuses (its keyless API
 * blacklists an IP for the day after a handful of requests). Either may be wrong without harm —
 * see the header — so neither is cross-checked; a coin listed twice is spent once.
 */
async function listCoins(address: string): Promise<ZcashCoin[]> {
  let coins: ZcashCoin[];
  try {
    coins = await blockchairCoins(address);
  } catch (first) {
    try {
      coins = await insightCoins(address);
    } catch (second) {
      throw new Error(`Zcash coins: ${(first as Error).message}; ${(second as Error).message}`);
    }
  }
  const seen = new Set<string>();
  return coins.filter((c) => {
    const key = `${c.txid}:${c.index}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/* ----------------------------------------------------------------------- send */

/**
 * Pay `p.amount` zatoshis from our transparent address to `p.to`. Answers the transaction id
 * once the node has accepted it. Everything that can be refused without a network is refused
 * first; then the node's identity and epoch are checked; then the coins are chosen and the fee
 * capped; only then is anything signed.
 */
export async function sendZcash(p: FamilyTransfer): Promise<string> {
  if (p.network !== 'zec' || p.env !== 'mainnet') throw new ChainSwapRefused('chain');
  const to = zcashOutputScript(p.to);
  if (!to) throw new ChainSwapRefused('address');
  // ZEC alone: a transparent output carries no token, and the registry lists none for Zcash.
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  if (p.memo) throw new ChainSwapRefused('memo');
  if (p.amount < zcashDustThreshold(to)) throw new ChainSwapRefused('minimum');
  const publicKey = secp256k1.getPublicKey(p.secret, true);
  if (p2pkhAddress(ZEC_P2PKH_VERSION, publicKey) !== p.owner) throw new Error('The Zcash key does not control the sending address');
  const change = p2pkhScript(hash160(publicKey));

  const state = await chainState();
  if (state.chain !== ZCASH_CHAIN_NAME) throw new ChainSwapRefused('chain');
  if ((await nodeCall('getblockhash', [0])) !== ZCASH_GENESIS_HASH) throw new ChainSwapRefused('chain');
  const window = zcashSendWindow(state.tip, state.nextBlockBranch, state.scheduled);
  if (!window) throw new ChainSwapRefused('chain');

  const plan = planZcashSend(await listCoins(p.owner), p.amount, to, change, p.maxFee);
  const { raw, txid } = signZcashTransfer(plan, p.secret, window);
  await nodeCall('sendrawtransaction', [bytesToHex(raw)]);
  return txid;
}
