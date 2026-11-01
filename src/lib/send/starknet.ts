/**
 * Paying from the wallet's Starknet account — the Argent X account `lib/addresses/starknet.ts`
 * derives (class v0.4.0, owner: the phrase's Stark key, no guardian) — in STRK, or in a registry
 * token should `def.tokens` ever list one, on the contract of `lib/send/types.ts`.
 *
 * An account on Starknet is a contract, so a first send is two transactions:
 *
 *   DEPLOY_ACCOUNT v3  only while the address has no class on chain: exactly the class hash, salt
 *                      (the public key) and constructor calldata the address is computed from, so
 *                      the contract lands at the address the wallet shows and nowhere else. Paid
 *                      from the STRK that address already holds; with none there, 'unfunded'.
 *   INVOKE v3          the account's `__execute__` with one call: token.transfer(to, u256).
 *
 * Both are hashed as the protocol does (Poseidon over the fields: resource bounds for L1 gas, L2
 * gas and L1 data gas, tip 0, no paymaster data, L1 data availability for the nonce and the fee,
 * the nonce and the chain id) and signed with the Stark key in Argent's concise owner form
 * `[r, s]` — the form v0.4 reads as the owner's signature when the account has no guardian.
 *
 * What a public node could decide, and does not:
 *  - the network: `starknet_chainId` must be the mode's (`STARKNET_CHAIN_ID`) before anything is
 *    signed — and the chain id is inside every hash signed, so a signature never crosses networks;
 *  - the fee: its estimate sets the resource bounds, but their total, the deployment included, is
 *    capped by `maxFee`, and a bound wider than the protocol's fields is refused, not truncated;
 *  - the transaction: its answer to a submission must be the hash the wallet computed and signed.
 *
 * Fees are estimated on the QUERY version with a signature over the query hash: Argent verifies a
 * signature before it looks at the version, so the estimate pays for the same validation the real
 * transaction runs, and the node is left holding a signature no sequencer executes.
 */
import { HDKey } from '@scure/bip32';
import { getStarkKey, grindKey, pedersen, poseidonHashMany, sign } from '@scure/starknet';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkDef, type NetworkId } from '@/constants/networks';
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  STARKNET_ADDRESS_BOUND,
  STARKNET_AMOUNT_HEADROOM_PCT,
  STARKNET_BALANCE_OF_SELECTOR,
  STARKNET_CHAIN_ID,
  STARKNET_DEPLOY_ACCOUNT_PREFIX,
  STARKNET_DEPLOY_POLL_MS,
  STARKNET_DEPLOY_TIMEOUT_MS,
  STARKNET_INVOKE_PREFIX,
  STARKNET_L1_DATA_GAS,
  STARKNET_L1_GAS,
  STARKNET_L2_GAS,
  STARKNET_PRICE_HEADROOM_PCT,
  STARKNET_QUERY_VERSION,
  STARKNET_RESERVED_ADDRESS_MAX,
  STARKNET_RPC,
  STARKNET_TRANSFER_SELECTOR,
  STARKNET_TX_VERSION,
  STRK_TOKEN,
} from '@/constants/starknetSend';
import { ARGENT_PATH } from '@/lib/addresses/starknet';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* --------------------------------- keys --------------------------------- */

/**
 * The Stark private key of the Argent X account whose phrase has `ethPrivateKey` as its Ethereum
 * key (`m/44'/60'/0'/0/0`): the 32-byte big-endian scalar `FamilyTransfer.secret` carries. The
 * same derivation as `argentAccountAddress` — the Ethereum key, read as a number (leading zero
 * bytes dropped), seeds a BIP-32 tree; `ARGENT_PATH` there is ground onto the Stark curve.
 */
export function starknetSecret(ethPrivateKey: Uint8Array): Uint8Array {
  const firstByte = ethPrivateKey.findIndex((b) => b !== 0);
  const master = HDKey.fromMasterSeed(ethPrivateKey.subarray(firstByte < 0 ? ethPrivateKey.length : firstByte));
  const node = master.derive(ARGENT_PATH);
  try {
    if (!node.privateKey) throw new Error(`No private key at ${ARGENT_PATH}`);
    return hexToBytes(grindKey(node.privateKey).padStart(64, '0'));
  } finally {
    node.wipePrivateData();
    master.wipePrivateData();
  }
}

/* ------------------------------- addresses ------------------------------- */

const CONTRACT_ADDRESS_PREFIX = bytesToNumberBE(utf8ToBytes('STARKNET_CONTRACT_ADDRESS'));
// Cairo's serialisation of Argent's constructor (owner: Signer, guardian: Option<Signer>): an
// enum is its variant index then its fields — Signer::Starknet is 0, Option::None is 1.
const SIGNER_STARKNET = 0n;
const GUARDIAN_NONE = 1n;
const U128 = 2n ** 128n;
const U64 = 2n ** 64n;

/** Starknet's Pedersen hash of a list: folded from 0 over the elements, then their count. */
const pedersenOnElements = (data: readonly bigint[]): bigint =>
  BigInt([...data, BigInt(data.length)].reduce<string | bigint>((acc, x) => pedersen(acc, x), 0n));

/** What deploys the account of `publicKey`, and the address that deployment lands at. */
export interface ArgentDeployment {
  address: bigint;
  classHash: bigint;
  salt: bigint;
  constructorCalldata: bigint[];
}

/** Argent v0.4.0 for `publicKey`: salt = the key, deployer 0 — `argentAccountAddress`'s formula. */
export function argentDeployment(publicKey: bigint): ArgentDeployment {
  const constructorCalldata = [SIGNER_STARKNET, publicKey, GUARDIAN_NONE];
  const hash = pedersenOnElements([
    CONTRACT_ADDRESS_PREFIX,
    0n,
    publicKey,
    ARGENT_ACCOUNT_CLASS_HASH,
    pedersenOnElements(constructorCalldata),
  ]);
  return { address: hash % STARKNET_ADDRESS_BOUND, classHash: ARGENT_ACCOUNT_CLASS_HASH, salt: publicKey, constructorCalldata };
}

/** sn_keccak: keccak-256 masked to 250 bits, Starknet's selector and checksum hash. */
const snKeccak = (bytes: Uint8Array): bigint => bytesToNumberBE(keccak_256(bytes)) & (2n ** 250n - 1n);

/**
 * The checksummed spelling of a Starknet address (starknet.js `getChecksumAddress`, after
 * EIP-55): the 64-digit form, each letter upper-cased where the matching nibble of sn_keccak of
 * the address's minimal big-endian bytes is 8 or more.
 */
export function starknetChecksumAddress(address: bigint): string {
  const chars = address.toString(16).padStart(64, '0').split('');
  const hex = address.toString(16);
  const hashed = hexToBytes(snKeccak(hexToBytes(hex.length % 2 ? `0${hex}` : hex)).toString(16).padStart(64, '0'));
  for (let i = 0; i < chars.length; i += 2) {
    if (hashed[i >> 1] >> 4 >= 8) chars[i] = chars[i].toUpperCase();
    if ((hashed[i >> 1] & 0x0f) >= 8) chars[i + 1] = chars[i + 1].toUpperCase();
  }
  return `0x${chars.join('')}`;
}

/**
 * Whether `address` is a recipient on `network` (Starknet's family) in `env` — the same format on
 * mainnet and Sepolia. `0x` and 1–64 hex digits naming a contract address: below 2^251 − 256 and
 * above the protocol's reserved 0x0–0x2. Mixed case is a checksum and must be the right one
 * (compared on the 64-digit form, whose leading zeros carry no case); one case is taken as is.
 */
export function isStarknetAddress(network: NetworkId, address: string, _env: ChainNet): boolean {
  if (NETWORKS[network]?.address !== 'starknet') return false;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) return false;
  const value = BigInt(address);
  if (value <= STARKNET_RESERVED_ADDRESS_MAX || value >= STARKNET_ADDRESS_BOUND) return false;
  const digits = address.slice(2);
  if (digits === digits.toLowerCase() || digits === digits.toUpperCase()) return true;
  return starknetChecksumAddress(value) === `0x${digits.padStart(64, '0')}`;
}

/* ------------------------------ transactions ----------------------------- */

/** One resource's cap: at most `maxAmount` units (u64) at `maxPrice` fri each (u128). */
export interface ResourceBound {
  maxAmount: bigint;
  maxPrice: bigint;
}

export interface ResourceBounds {
  l1Gas: ResourceBound;
  l2Gas: ResourceBound;
  l1DataGas: ResourceBound;
}

export const ZERO_BOUNDS: ResourceBounds = {
  l1Gas: { maxAmount: 0n, maxPrice: 0n },
  l2Gas: { maxAmount: 0n, maxPrice: 0n },
  l1DataGas: { maxAmount: 0n, maxPrice: 0n },
};

/** Whether every bound fits its field: wider would bleed into the next one in the hash. */
const boundsFit = (b: ResourceBounds): boolean =>
  [b.l1Gas, b.l2Gas, b.l1DataGas].every((r) => r.maxAmount >= 0n && r.maxAmount < U64 && r.maxPrice >= 0n && r.maxPrice < U128);

/** The most a transaction with these bounds can be charged, in fri (tip 0). */
export const maxFeeOf = (b: ResourceBounds): bigint =>
  b.l1Gas.maxAmount * b.l1Gas.maxPrice + b.l2Gas.maxAmount * b.l2Gas.maxPrice + b.l1DataGas.maxAmount * b.l1DataGas.maxPrice;

const packBound = (name: bigint, r: ResourceBound): bigint => (name << 192n) | (r.maxAmount << 128n) | r.maxPrice;

/** Poseidon(tip, L1 gas, L2 gas, L1 data gas): the fee field of a v3 hash. */
export function feeFieldHash(tip: bigint, bounds: ResourceBounds): bigint {
  if (!boundsFit(bounds)) throw new RangeError('A Starknet resource bound is wider than its field');
  return poseidonHashMany([
    tip,
    packBound(STARKNET_L1_GAS, bounds.l1Gas),
    packBound(STARKNET_L2_GAS, bounds.l2Gas),
    packBound(STARKNET_L1_DATA_GAS, bounds.l1DataGas),
  ]);
}

/** The fields an INVOKE and a DEPLOY_ACCOUNT v3 share. DA modes are L1 (0) and the paymaster data empty. */
export interface V3Fields {
  chainId: bigint;
  nonce: bigint;
  bounds: ResourceBounds;
  /** `STARKNET_TX_VERSION`, or `STARKNET_QUERY_VERSION` for an estimate. */
  version: bigint;
  /** Always 0 when the wallet signs; a parameter only so the protocol's own vectors can be checked. */
  tip?: bigint;
}

const v3Hash = (prefix: bigint, sender: bigint, f: V3Fields, tail: bigint[]): bigint =>
  poseidonHashMany([prefix, f.version, sender, feeFieldHash(f.tip ?? 0n, f.bounds), poseidonHashMany([]), f.chainId, f.nonce, 0n, ...tail]);

/** An INVOKE v3 hash; `calldata` is what `__execute__` receives. No account deployment data. */
export const invokeHash = (sender: bigint, calldata: readonly bigint[], f: V3Fields): bigint =>
  v3Hash(STARKNET_INVOKE_PREFIX, sender, f, [poseidonHashMany([]), poseidonHashMany([...calldata])]);

/** A DEPLOY_ACCOUNT v3 hash; its "sender" is the address being deployed. */
export const deployAccountHash = (d: ArgentDeployment, f: V3Fields): bigint =>
  v3Hash(STARKNET_DEPLOY_ACCOUNT_PREFIX, d.address, f, [poseidonHashMany([...d.constructorCalldata]), d.classHash, d.salt]);

export interface StarknetCall {
  to: bigint;
  selector: bigint;
  calldata: readonly bigint[];
}

/** `token.transfer(recipient, amount)`, the amount a u256 as Cairo serialises it: low, then high. */
export function transferCall(token: bigint, recipient: bigint, amount: bigint): StarknetCall {
  if (amount < 0n || amount >= U128 * U128) throw new RangeError('A transfer amount is a u256');
  return { to: token, selector: STARKNET_TRANSFER_SELECTOR, calldata: [recipient, amount % U128, amount / U128] };
}

/**
 * `__execute__(calls: Array<Call>)` as a Cairo 1 account (Argent v0.4 included) reads it: the
 * number of calls, then each as `to, selector, calldata.len, ...calldata`.
 */
export function executeCalldata(calls: readonly StarknetCall[]): bigint[] {
  return [BigInt(calls.length), ...calls.flatMap((c) => [c.to, c.selector, BigInt(c.calldata.length), ...c.calldata])];
}

const hex = (n: bigint): string => `0x${n.toString(16)}`;

/** Argent's concise owner signature: `[r, s]` over the hash. */
function signHash(hash: bigint, secret: Uint8Array): string[] {
  const sig = sign(hex(hash), secret);
  return [hex(sig.r), hex(sig.s)];
}

const wireBounds = (b: ResourceBounds) => ({
  l1_gas: { max_amount: hex(b.l1Gas.maxAmount), max_price_per_unit: hex(b.l1Gas.maxPrice) },
  l2_gas: { max_amount: hex(b.l2Gas.maxAmount), max_price_per_unit: hex(b.l2Gas.maxPrice) },
  l1_data_gas: { max_amount: hex(b.l1DataGas.maxAmount), max_price_per_unit: hex(b.l1DataGas.maxPrice) },
});

/** A transaction as the JSON-RPC takes it, and the hash its signature is over. */
export interface SignedStarknetTx {
  hash: bigint;
  wire: Record<string, unknown>;
}

/** The account's DEPLOY_ACCOUNT v3, signed by `secret`. */
export function signedDeployAccount(d: ArgentDeployment, f: V3Fields, secret: Uint8Array): SignedStarknetTx {
  const hash = deployAccountHash(d, f);
  return {
    hash,
    wire: {
      type: 'DEPLOY_ACCOUNT',
      version: hex(f.version),
      signature: signHash(hash, secret),
      nonce: hex(f.nonce),
      contract_address_salt: hex(d.salt),
      constructor_calldata: d.constructorCalldata.map(hex),
      class_hash: hex(d.classHash),
      resource_bounds: wireBounds(f.bounds),
      tip: hex(f.tip ?? 0n),
      paymaster_data: [],
      nonce_data_availability_mode: 'L1',
      fee_data_availability_mode: 'L1',
    },
  };
}

/** An INVOKE v3 from `sender` running `calls`, signed by `secret`. */
export function signedInvoke(sender: bigint, calls: readonly StarknetCall[], f: V3Fields, secret: Uint8Array): SignedStarknetTx {
  const calldata = executeCalldata(calls);
  const hash = invokeHash(sender, calldata, f);
  return {
    hash,
    wire: {
      type: 'INVOKE',
      sender_address: hex(sender),
      calldata: calldata.map(hex),
      version: hex(f.version),
      signature: signHash(hash, secret),
      nonce: hex(f.nonce),
      resource_bounds: wireBounds(f.bounds),
      tip: hex(f.tip ?? 0n),
      paymaster_data: [],
      account_deployment_data: [],
      nonce_data_availability_mode: 'L1',
      fee_data_availability_mode: 'L1',
    },
  };
}

/* -------------------------------- the node ------------------------------- */

/** A JSON-RPC error from the node: its code (the spec's, e.g. 20 contract not found) and data. */
export class StarknetRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'StarknetRpcError';
    this.code = code;
    this.data = data;
  }
}

const CONTRACT_NOT_FOUND = 20;
const INSUFFICIENT_ACCOUNT_BALANCE = 54;

let rpcId = 1;

async function call<T>(url: string, method: string, params: Record<string, unknown>, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  const relay = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', relay, { once: true });
  try {
    // Nothing about the person but the address: no cookies, no referrer.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      signal: ctrl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new StarknetRpcError(`${method}: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
    // The message is the spec's fixed text; the data (which can echo addresses) stays on the error.
    if (body.error) throw new StarknetRpcError(`${method}: ${body.error.message || 'failed'}`, body.error.code, body.error.data);
    if (body.result === undefined) throw new StarknetRpcError(`${method}: no result`);
    return body.result;
  } catch (e) {
    if (e instanceof StarknetRpcError) throw e;
    throw new StarknetRpcError(ctrl.signal.aborted ? `${method}: timed out` : `${method}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

/** A felt as the node writes it; anything else is a node not worth believing. */
function felt(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new Error(`Starknet node answered a malformed ${what}`);
  return BigInt(v);
}

/** The block a send reads and estimates against: the one being built, so a nonce just used counts. */
const PENDING = 'pre_confirmed';

/** `token.balance_of(owner)` at `block`, the u256 read back as low + high·2^128. */
export async function starknetBalanceAt(url: string, token: bigint, owner: bigint, block = 'latest', signal?: AbortSignal): Promise<bigint> {
  const result = await call<unknown>(
    url,
    'starknet_call',
    { request: { contract_address: hex(token), entry_point_selector: hex(STARKNET_BALANCE_OF_SELECTOR), calldata: [hex(owner)] }, block_id: block },
    signal,
  );
  if (!Array.isArray(result) || result.length !== 2) throw new Error('Starknet node answered a malformed balance');
  const [low, high] = [felt(result[0], 'balance'), felt(result[1], 'balance')];
  if (low >= U128 || high >= U128) throw new Error('Starknet node answered a malformed balance');
  return low + high * U128;
}

/** STRK held by `address` on Starknet in `env`, in fri. Undeployed accounts hold tokens too. */
export async function readStarknetBalance(env: ChainNet, address: string, signal?: AbortSignal): Promise<bigint> {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) throw new Error('Not a Starknet address');
  return starknetBalanceAt(STARKNET_RPC[env], STRK_TOKEN, BigInt(address), 'latest', signal);
}

/** The account's class hash, or null while nothing is deployed there. */
async function classHashAt(url: string, address: bigint): Promise<bigint | null> {
  try {
    return felt(await call<unknown>(url, 'starknet_getClassHashAt', { block_id: PENDING, contract_address: hex(address) }), 'class hash');
  } catch (e) {
    if (e instanceof StarknetRpcError && e.code === CONTRACT_NOT_FOUND) return null;
    throw e;
  }
}

async function nonceAt(url: string, address: bigint): Promise<bigint> {
  return felt(await call<unknown>(url, 'starknet_getNonce', { block_id: PENDING, contract_address: hex(address) }), 'nonce');
}

const withHeadroom = (consumed: bigint, price: bigint): ResourceBound => ({
  maxAmount: (consumed * STARKNET_AMOUNT_HEADROOM_PCT + 99n) / 100n,
  maxPrice: (price * STARKNET_PRICE_HEADROOM_PCT + 99n) / 100n,
});

/**
 * `starknet_estimateFee` of `txs` run in order (validation on), each turned into resource bounds
 * with the headroom of `constants/starknetSend.ts`. A unit other than FRI is not a v3 estimate.
 */
export async function estimateStarknetBounds(url: string, txs: readonly SignedStarknetTx[]): Promise<ResourceBounds[]> {
  const result = await call<unknown>(url, 'starknet_estimateFee', { request: txs.map((t) => t.wire), simulation_flags: [], block_id: PENDING });
  if (!Array.isArray(result) || result.length !== txs.length) throw new Error('Starknet node answered a malformed fee estimate');
  return result.map((raw) => {
    const e = raw as Record<string, unknown>;
    if (e?.unit !== 'FRI') throw new Error('Starknet node answered a fee estimate not in FRI');
    return {
      l1Gas: withHeadroom(felt(e.l1_gas_consumed, 'fee estimate'), felt(e.l1_gas_price, 'fee estimate')),
      l2Gas: withHeadroom(felt(e.l2_gas_consumed, 'fee estimate'), felt(e.l2_gas_price, 'fee estimate')),
      l1DataGas: withHeadroom(felt(e.l1_data_gas_consumed, 'fee estimate'), felt(e.l1_data_gas_price, 'fee estimate')),
    };
  });
}

/** Hand `tx` to the node; its answer must be the hash the wallet signed. */
async function submit(url: string, tx: SignedStarknetTx): Promise<void> {
  const deploy = tx.wire.type === 'DEPLOY_ACCOUNT';
  let result: { transaction_hash?: unknown };
  try {
    result = await call<{ transaction_hash?: unknown }>(
      url,
      deploy ? 'starknet_addDeployAccountTransaction' : 'starknet_addInvokeTransaction',
      deploy ? { deploy_account_transaction: tx.wire } : { invoke_transaction: tx.wire },
    );
  } catch (e) {
    // The balance moved between the read and the submission: the same answer the read would give.
    if (e instanceof StarknetRpcError && e.code === INSUFFICIENT_ACCOUNT_BALANCE) throw new ChainSwapRefused('funds');
    throw e;
  }
  if (felt(result?.transaction_hash, 'transaction hash') !== tx.hash) throw new Error('Starknet node answered another transaction hash');
}

/**
 * Wait until the node shows `hash` executed (pre-confirmed or accepted). A reverted or rejected
 * one, or none in `STARKNET_DEPLOY_TIMEOUT_MS`, is an error: the transfer is not sent behind it.
 * A failed poll is not an answer — the deployment is already broadcast — so it is asked again.
 */
async function executed(url: string, hash: bigint, pollMs: number): Promise<void> {
  const deadline = Date.now() + STARKNET_DEPLOY_TIMEOUT_MS;
  for (;;) {
    let status: { finality_status?: unknown; execution_status?: unknown } | null = null;
    try {
      status = await call(url, 'starknet_getTransactionStatus', { transaction_hash: hex(hash) });
    } catch (e) {
      // Not seen yet by this node (code 29, hash not found), or the poll itself failed: ask again.
      if (!(e instanceof StarknetRpcError)) throw e;
    }
    const finality = status?.finality_status;
    if (finality === 'REJECTED') throw new Error('Starknet rejected the account deployment');
    if (finality === 'PRE_CONFIRMED' || finality === 'ACCEPTED_ON_L2' || finality === 'ACCEPTED_ON_L1') {
      if (status?.execution_status === 'SUCCEEDED') return;
      if (status?.execution_status === 'REVERTED') throw new Error('The Starknet account deployment reverted');
    }
    if (Date.now() + pollMs > deadline) throw new Error('The Starknet account deployment was not confirmed in time');
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** The node of `def` when it names a Starknet one, else the mode's own. */
function rpcOf(def: NetworkDef, env: ChainNet): string {
  const source = def.balance as { kind: string; rpc?: unknown } | null;
  return source?.kind === 'starknet' && typeof source.rpc === 'string' ? source.rpc : STARKNET_RPC[env];
}

/* --------------------------------- send ---------------------------------- */

/**
 * Pay `p.amount` of STRK (or a `def.tokens` asset) from our Argent account to `p.to`, deploying
 * the account first if this is its first send. Answers the transfer's hash once the node accepted
 * it. `pollMs` is the deployment's status poll (`STARKNET_DEPLOY_POLL_MS`); only a test shortens it.
 */
export async function sendStarknet(p: FamilyTransfer, pollMs: number = STARKNET_DEPLOY_POLL_MS): Promise<string> {
  if (NETWORKS[p.network]?.address !== 'starknet') throw new ChainSwapRefused('chain');
  // A Starknet transfer has nowhere to carry a memo; a deposit that needs one is not paid without it.
  if (p.memo) throw new ChainSwapRefused('memo');
  if (!isStarknetAddress(p.network, p.to, p.env)) throw new ChainSwapRefused('address');
  const tokenEntry = p.asset === 'native' ? null : p.def.tokens.find((t) => t.asset === p.asset);
  if (p.asset !== 'native' && (!tokenEntry || !/^0x[0-9a-fA-F]{1,64}$/.test(tokenEntry.asset))) throw new ChainSwapRefused('address');
  const token = tokenEntry ? BigInt(tokenEntry.asset) : STRK_TOKEN;
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  if (p.amount >= U128 * U128) throw new ChainSwapRefused('funds');
  if (p.secret.length !== 32) throw new Error('A Starknet key is 32 bytes');

  // The key must be the account's owner: the deployment, and so every hash, is computed from it.
  const account = argentDeployment(BigInt(getStarkKey(p.secret)));
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(p.owner) || BigInt(p.owner) !== account.address) {
    throw new Error('The Starknet key does not control the account the wallet shows');
  }

  const url = rpcOf(p.def, p.env);
  const chainId = STARKNET_CHAIN_ID[p.env];
  if (felt(await call<unknown>(url, 'starknet_chainId', {}), 'chain id') !== chainId) throw new ChainSwapRefused('chain');

  const [classHash, strk, tokenBalance] = await Promise.all([
    classHashAt(url, account.address),
    starknetBalanceAt(url, STRK_TOKEN, account.address, PENDING),
    token === STRK_TOKEN ? Promise.resolve(null) : starknetBalanceAt(url, token, account.address, PENDING),
  ]);
  const deployed = classHash !== null;
  // Nothing deployed and no STRK to deploy with: the address has never been paid on Starknet.
  if (!deployed && strk === 0n) throw new ChainSwapRefused('unfunded');
  if ((tokenBalance ?? strk) < p.amount) throw new ChainSwapRefused('funds');
  const nonce = deployed ? await nonceAt(url, account.address) : 1n;

  const calls = [transferCall(token, BigInt(p.to), p.amount)];
  const query = (n: bigint): V3Fields => ({ chainId, nonce: n, bounds: ZERO_BOUNDS, version: STARKNET_QUERY_VERSION });
  const estimated = await estimateStarknetBounds(url, [
    ...(deployed ? [] : [signedDeployAccount(account, query(0n), p.secret)]),
    signedInvoke(account.address, calls, query(nonce), p.secret),
  ]);
  // The estimate is the node's word. Whatever it says, the bounds fit their fields and one send —
  // the deployment included — never costs more than `maxFee`.
  if (!estimated.every(boundsFit)) throw new ChainSwapRefused('fee');
  const maxFee = estimated.reduce((sum, b) => sum + maxFeeOf(b), 0n);
  if (maxFee > p.maxFee) throw new ChainSwapRefused('fee');
  // Starknet admits a transaction only if the account can pay its whole cap, and the transfer
  // must still fit after the fees: the coin covers both when it is the coin being sent.
  if (tokenBalance === null ? strk < p.amount + maxFee : strk < maxFee) throw new ChainSwapRefused('funds');

  const real = (n: bigint, bounds: ResourceBounds): V3Fields => ({ chainId, nonce: n, bounds, version: STARKNET_TX_VERSION });
  if (!deployed) {
    const deploy = signedDeployAccount(account, real(0n, estimated[0]), p.secret);
    await submit(url, deploy);
    await executed(url, deploy.hash, pollMs);
  }
  const transfer = signedInvoke(account.address, calls, real(nonce, estimated[estimated.length - 1]), p.secret);
  await submit(url, transfer);
  return `0x${transfer.hash.toString(16).padStart(64, '0')}`;
}
