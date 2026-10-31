/**
 * Paying on Sui (`lib/send/types.ts` is the contract): SUI, or a token of `def.tokens` (USDC),
 * from the wallet's address — blake2b-256(0x00 ‖ the ed25519 key at m/44'/784'/0'/0'/0').
 *
 * The transfer is a programmable transaction built here in BCS and signed over
 * blake2b-256(intent ‖ bytes). What the address holds comes in two forms, and both are spent:
 * coin OBJECTS (the classic form) and the address BALANCE (SIP-58: funds sent to an address
 * rather than as an object; a `FundsWithdrawal` input reserves them and `0x2::coin::redeem_funds`
 * turns them into a coin inside the transaction). Gas comes from the SUI coins when they cover
 * the budget, else from the SUI address balance (no gas object at all).
 *
 * The node — Sui's public GraphQL service — is asked for state, a simulation and to execute,
 * never to decide:
 *
 * - **The network.** Its `chainIdentifier` must be `SUI_CHAIN_ID[env]`, and every transaction
 *   carries that identifier in its `ValidDuring` expiration, which the validators check: the
 *   signature is void on another network — on the test network too, where the same key owns the
 *   same address on mainnet.
 * - **The fee.** The budget is the simulation's cost plus the SDK's safety overhead, and is the
 *   most the transfer can ever cost; above `maxFee` it is refused, not signed.
 * - **The transfer.** Built here, recipient and amount included; the node only fills in prices
 *   and object versions, and a version it lies about makes the transaction invalid, nothing else.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  SUI_CHAIN_ID,
  SUI_COIN_PAGE_SIZE,
  SUI_COIN_TYPE,
  SUI_EXECUTE_TIMEOUT_MS,
  SUI_GAS_SAFE_OVERHEAD,
  SUI_GRAPHQL_TIMEOUT_MS,
  SUI_MAX_COIN_PAGES,
  SUI_MIN_BUDGET_UNITS,
} from '@/constants/suiSend';
import { ChainSwapRefused } from '@/lib/chainSwap';
import type { FamilyTransfer } from '@/lib/send/types';

/* --------------------------------- addresses --------------------------------- */

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Whether `address` is an account on `network`: `0x` and the full 64 hex digits. The short
 * forms Sui's SDK pads (`0x2`) are system objects, not people; a shortened personal address is a
 * digit lost in a copy, so it is refused rather than padded into someone else's.
 */
export function isSuiAddress(network: NetworkId, address: string, _env: ChainNet): boolean {
  return NETWORKS[network].address === 'sui' && SUI_ADDRESS_RE.test(address);
}

/** The address an ed25519 public key controls: blake2b-256(0x00 ‖ key), 0x-hex. */
export function suiAddressOf(publicKey: Uint8Array): string {
  return `0x${bytesToHex(blake2b(concatBytes(Uint8Array.of(0x00), publicKey), { dkLen: 32 }))}`;
}

/* ------------------------------------ BCS ------------------------------------ */

function uleb128(value: number): Uint8Array {
  const out: number[] = [];
  let v = value;
  do {
    const byte = v & 0x7f;
    v = Math.floor(v / 128);
    out.push(v ? byte | 0x80 : byte);
  } while (v);
  return Uint8Array.from(out);
}

function uint(value: bigint, bytes: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) throw new Error(`Sui: integer out of range for ${bytes * 8} bits`);
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const u16 = (n: number) => uint(BigInt(n), 2);
const u64 = (n: bigint) => uint(n, 8);
const vec = (items: Uint8Array[]) => concatBytes(uleb128(items.length), ...items);
const bytesVec = (b: Uint8Array) => concatBytes(uleb128(b.length), b);
const str = (s: string) => bytesVec(utf8ToBytes(s));

/** A 32-byte address from `0x` hex, short system forms (`0x2`) left-padded as Move writes them. */
function address32(hex: string): Uint8Array {
  const digits = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{1,64}$/.test(digits)) throw new Error('Sui: not an address');
  return hexToBytes(digits.padStart(64, '0'));
}

/** A 32-byte digest written base58 (object digests, the chain identifier), BCS'd as a length-prefixed vector. */
function digest32(b58: string): Uint8Array {
  const bytes = base58.decode(b58);
  if (bytes.length !== 32) throw new Error('Sui: a digest is 32 bytes');
  return bytesVec(bytes);
}

/**
 * `TypeTag::Struct` of a coin type `0xADDR::module::Name`. Registry coin types have no type
 * parameters; one that has them is refused rather than half-encoded.
 */
function coinTypeTag(coinType: string): Uint8Array {
  const parts = coinType.split('::');
  if (parts.length !== 3 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[1]) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[2])) {
    throw new Error('Sui: unsupported coin type');
  }
  return concatBytes(Uint8Array.of(7), address32(parts[0]), str(parts[1]), str(parts[2]), uleb128(0));
}

export interface SuiObjectRef {
  /** 0x + 64 hex. */
  id: string;
  version: bigint;
  /** base58. */
  digest: string;
}

/** A transaction argument: the gas coin, an input, a command's result, or one value of a command's results. */
export type SuiArg = { gas: true } | { input: number } | { result: number } | { nested: [number, number] };

export type SuiInput =
  | { pure: Uint8Array }
  | { owned: SuiObjectRef }
  /** SIP-58: reserve `amount` of `coinType` from the sender's address balance. */
  | { withdraw: { amount: bigint; coinType: string } };

export type SuiCommand =
  | { split: { coin: SuiArg; amounts: SuiArg[] } }
  | { merge: { into: SuiArg; from: SuiArg[] } }
  | { transfer: { objects: SuiArg[]; to: SuiArg } }
  /** `0x2::coin::redeem_funds<coinType>(withdrawal)`: a withdrawal input made a coin. */
  | { redeem: { coinType: string; withdrawal: SuiArg } };

export interface SuiTransaction {
  sender: string;
  inputs: SuiInput[];
  commands: SuiCommand[];
  gas: { payment: SuiObjectRef[]; owner: string; price: bigint; budget: bigint };
  /** `ValidDuring`: valid in epochs `minEpoch..maxEpoch` of the network `chain` names; `nonce` keeps two equal transfers distinct. */
  expiration: { none: true } | { validDuring: { minEpoch: bigint; maxEpoch: bigint; chain: string; nonce: number } };
}

const objectRef = (r: SuiObjectRef) => concatBytes(address32(r.id), u64(r.version), digest32(r.digest));

function argument(a: SuiArg): Uint8Array {
  if ('gas' in a) return Uint8Array.of(0);
  if ('input' in a) return concatBytes(Uint8Array.of(1), u16(a.input));
  if ('result' in a) return concatBytes(Uint8Array.of(2), u16(a.result));
  return concatBytes(Uint8Array.of(3), u16(a.nested[0]), u16(a.nested[1]));
}

function input(i: SuiInput): Uint8Array {
  // CallArg: Pure 0, Object 1 (ObjectArg::ImmOrOwnedObject 0), FundsWithdrawal 2.
  if ('pure' in i) return concatBytes(Uint8Array.of(0), bytesVec(i.pure));
  if ('owned' in i) return concatBytes(Uint8Array.of(1, 0), objectRef(i.owned));
  // FundsWithdrawalArg { Reservation::MaxAmountU64, WithdrawalTypeArg::Balance(T), WithdrawFrom::Sender }
  return concatBytes(Uint8Array.of(2, 0), u64(i.withdraw.amount), Uint8Array.of(0), coinTypeTag(i.withdraw.coinType), Uint8Array.of(0));
}

function command(c: SuiCommand): Uint8Array {
  // Command: MoveCall 0, TransferObjects 1, SplitCoins 2, MergeCoins 3.
  if ('transfer' in c) return concatBytes(Uint8Array.of(1), vec(c.transfer.objects.map(argument)), argument(c.transfer.to));
  if ('split' in c) return concatBytes(Uint8Array.of(2), argument(c.split.coin), vec(c.split.amounts.map(argument)));
  if ('merge' in c) return concatBytes(Uint8Array.of(3), argument(c.merge.into), vec(c.merge.from.map(argument)));
  return concatBytes(
    Uint8Array.of(0),
    address32('0x2'),
    str('coin'),
    str('redeem_funds'),
    vec([coinTypeTag(c.redeem.coinType)]),
    vec([argument(c.redeem.withdrawal)]),
  );
}

/** The BCS of `TransactionData::V1` with a programmable transaction. */
export function suiTxBytes(tx: SuiTransaction): Uint8Array {
  const exp = tx.expiration;
  const expiration =
    'none' in exp
      ? Uint8Array.of(0)
      : concatBytes(
          Uint8Array.of(2, 1),
          u64(exp.validDuring.minEpoch),
          Uint8Array.of(1),
          u64(exp.validDuring.maxEpoch),
          Uint8Array.of(0, 0),
          digest32(exp.validDuring.chain),
          uint(BigInt(exp.validDuring.nonce), 4),
        );
  return concatBytes(
    Uint8Array.of(0, 0), // TransactionData::V1, TransactionKind::ProgrammableTransaction
    vec(tx.inputs.map(input)),
    vec(tx.commands.map(command)),
    address32(tx.sender),
    vec(tx.gas.payment.map(objectRef)),
    address32(tx.gas.owner),
    u64(tx.gas.price),
    u64(tx.gas.budget),
    expiration,
  );
}

/** Intent (TransactionData, V0, Sui) that prefixes what a transaction signature covers. */
const TX_INTENT = Uint8Array.of(0, 0, 0);

/** What an ed25519 signature of the transaction covers: blake2b-256(intent ‖ bytes). */
export const suiSigningMessage = (bytes: Uint8Array) => blake2b(concatBytes(TX_INTENT, bytes), { dkLen: 32 });

/** The transaction's digest, its id on chain: base58 of blake2b-256("TransactionData::" ‖ bytes). */
export const suiTxDigest = (bytes: Uint8Array) => base58.encode(blake2b(concatBytes(utf8ToBytes('TransactionData::'), bytes), { dkLen: 32 }));

/**
 * Sign transaction bytes. Answers the serialized signature (flag 0x00 for ed25519 ‖ signature ‖
 * public key, base64) and the digest.
 */
export function signSuiTx(bytes: Uint8Array, seed: Uint8Array): { signature: string; digest: string } {
  const sig = ed25519.sign(suiSigningMessage(bytes), seed);
  return { signature: base64.encode(concatBytes(Uint8Array.of(0x00), sig, ed25519.getPublicKey(seed))), digest: suiTxDigest(bytes) };
}

/* ------------------------------------ plan ------------------------------------ */

export interface SuiCoin {
  ref: SuiObjectRef;
  balance: bigint;
}

/** What the address holds of one coin type: its coin objects and its address balance. */
export interface SuiHoldings {
  coins: SuiCoin[];
  addressBalance: bigint;
}

export interface SuiPlanInput {
  sender: string;
  to: string;
  amount: bigint;
  /** `SUI_COIN_TYPE`, or a token's coin type. */
  coinType: string;
  sui: SuiHoldings;
  /** The token's holdings (ignored for SUI). */
  token: SuiHoldings;
  price: bigint;
  budget: bigint;
  epoch: bigint;
  chain: string;
  nonce: number;
}

/** The coins whose balances, largest first, cover `need`; all of them when none do. */
function pick(coins: SuiCoin[], need: bigint, max: number): SuiCoin[] {
  const sorted = [...coins].sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0)).slice(0, max);
  const out: SuiCoin[] = [];
  let sum = 0n;
  for (const c of sorted) {
    if (sum >= need && out.length > 0) break;
    out.push(c);
    sum += c.balance;
  }
  return out;
}

const total = (coins: SuiCoin[]) => coins.reduce((s, c) => s + c.balance, 0n);

/** The protocol takes up to 256 gas objects (`max_gas_payment_objects`). */
const MAX_GAS_OBJECTS = 256;
/** Coin objects merged as plain inputs; far below the protocol's 2 048 inputs. */
const MAX_COIN_INPUTS = 250;

/**
 * The transfer of `amount` to `to` with `budget`, or null when what the address holds cannot
 * pay both. Gas: the SUI coins when they cover the budget, else the SUI address balance. The
 * amount: coin objects first, the address balance for the rest — both made one coin, then split
 * (or handed over whole when the amount is exactly what was gathered).
 */
export function planSuiTransfer(p: SuiPlanInput): SuiTransaction | null {
  const inputs: SuiInput[] = [];
  const commands: SuiCommand[] = [];
  const addInput = (i: SuiInput): SuiArg => ({ input: inputs.push(i) - 1 });
  const addCommand = (c: SuiCommand): number => commands.push(c) - 1;
  const native = p.coinType === SUI_COIN_TYPE;

  const suiCoins = native ? pick(p.sui.coins, p.amount + p.budget, MAX_GAS_OBJECTS) : pick(p.sui.coins, p.budget, MAX_GAS_OBJECTS);
  const gasFromCoins = total(suiCoins) >= p.budget;
  if (!gasFromCoins && p.sui.addressBalance < p.budget) return null;

  // Where the amount comes from: coin objects first (for SUI, what the gas coins hold past the
  // budget, or — gas paid from the address balance — the SUI coins as plain inputs), the address
  // balance for the rest.
  const held = native ? p.sui : p.token;
  const coinPart = native ? (gasFromCoins ? total(suiCoins) - p.budget : total(suiCoins)) : total(pick(held.coins, p.amount, MAX_COIN_INPUTS));
  const fromCoins = coinPart < p.amount ? coinPart : p.amount;
  const withdraw = p.amount - fromCoins;
  // A SUI withdrawal and an address-balance gas payment draw on the same balance.
  const sameBalanceDraw = native && !gasFromCoins ? withdraw + p.budget : withdraw;
  if (sameBalanceDraw > held.addressBalance) return null;

  let coin: SuiArg | null = null;
  let gathered = 0n;
  if (native && gasFromCoins) {
    if (fromCoins > 0n || withdraw > 0n) coin = { gas: true };
  } else if (fromCoins > 0n) {
    const coins = native ? suiCoins : pick(held.coins, p.amount, MAX_COIN_INPUTS);
    const [first, ...rest] = coins.map((c) => addInput({ owned: c.ref }));
    if (rest.length > 0) addCommand({ merge: { into: first, from: rest } });
    coin = first;
    gathered = total(coins);
  }
  if (withdraw > 0n) {
    const w = addInput({ withdraw: { amount: withdraw, coinType: p.coinType } });
    const redeemed: SuiArg = { result: addCommand({ redeem: { coinType: p.coinType, withdrawal: w } }) };
    if (coin) addCommand({ merge: { into: coin, from: [redeemed] } });
    else coin = redeemed;
    gathered += withdraw;
  }
  if (!coin) return null;

  // The gas coin is never handed over whole (it pays the gas); another coin is when it is exactly
  // the amount, which leaves no empty coin object behind.
  if ('gas' in coin || gathered !== p.amount) {
    const amount = addInput({ pure: u64(p.amount) });
    const split = addCommand({ split: { coin, amounts: [amount] } });
    const to = addInput({ pure: address32(p.to) });
    addCommand({ transfer: { objects: [{ nested: [split, 0] }], to } });
  } else {
    const to = addInput({ pure: address32(p.to) });
    addCommand({ transfer: { objects: [coin], to } });
  }

  return {
    sender: p.sender,
    inputs,
    commands,
    gas: { payment: gasFromCoins ? suiCoins.map((c) => c.ref) : [], owner: p.sender, price: p.price, budget: p.budget },
    expiration: { validDuring: { minEpoch: p.epoch, maxEpoch: p.epoch + 1n, chain: p.chain, nonce: p.nonce } },
  };
}

/* ---------------------------------- GraphQL ---------------------------------- */

/** A node's message, short and without the addresses and object ids it tends to echo. */
const nodeMessage = (m: string) => m.replace(/0x[0-9a-fA-F]{6,}/g, '0x…').slice(0, 200);

async function graphql(url: string, query: string, variables: Record<string, unknown>, timeoutMs = SUI_GRAPHQL_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Sui GraphQL: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown; errors?: unknown };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const first = body.errors[0] as { message?: unknown };
      throw new Error(`Sui GraphQL: ${typeof first?.message === 'string' ? nodeMessage(first.message) : 'error'}`);
    }
    if (!body.data || typeof body.data !== 'object') throw new Error('Sui GraphQL: no data');
    return body.data as Record<string, unknown>;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Sui GraphQL: timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const shapeError = (what: string) => new Error(`Sui ${what}: unexpected answer`);
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw shapeError(what);
  return v as Record<string, unknown>;
};
/** An unsigned integer GraphQL wrote as digits (`BigInt`) or as a JSON number (`UInt53`). */
function unsigned(v: unknown, what: string): bigint {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw shapeError(what);
}

const COIN_FIELDS = 'pageInfo { hasNextPage endCursor } nodes { address version digest contents { json } }';

function readCoins(conn: unknown): { coins: SuiCoin[]; next: string | null } {
  const c = obj(conn, 'objects');
  const page = obj(c.pageInfo, 'objects');
  if (!Array.isArray(c.nodes)) throw shapeError('objects');
  const coins = c.nodes.map((n) => {
    const node = obj(n, 'objects');
    if (typeof node.address !== 'string' || !SUI_ADDRESS_RE.test(node.address) || typeof node.digest !== 'string') throw shapeError('objects');
    const json = obj(obj(node.contents, 'objects').json, 'objects');
    return { ref: { id: node.address, version: unsigned(node.version, 'objects'), digest: node.digest }, balance: unsigned(json.balance, 'objects') };
  });
  return { coins, next: page.hasNextPage === true && typeof page.endCursor === 'string' ? page.endCursor : null };
}

const coinObjectType = (coinType: string) => `0x2::coin::Coin<${coinType}>`;

/** Every coin object of `coinType` the owner holds, up to `SUI_MAX_COIN_PAGES` pages; `first` is the page already read. */
async function allCoins(url: string, owner: string, coinType: string, first: { coins: SuiCoin[]; next: string | null }): Promise<SuiCoin[]> {
  const coins = [...first.coins];
  let after = first.next;
  for (let page = 1; after && page < SUI_MAX_COIN_PAGES; page++) {
    const data = await graphql(
      url,
      `query ($owner: SuiAddress!, $type: String!, $after: String) { address(address: $owner) { objects(first: ${SUI_COIN_PAGE_SIZE}, after: $after, filter: { type: $type }) { ${COIN_FIELDS} } } }`,
      { owner, type: coinObjectType(coinType), after },
    );
    const read = readCoins(obj(data.address, 'address').objects);
    coins.push(...read.coins);
    after = read.next;
  }
  return coins;
}

function readBalance(v: unknown): bigint {
  // An address that never held the type answers null; a service without SIP-58 omits the field.
  if (v === null || v === undefined) return 0n;
  const b = obj(v, 'balance');
  return b.addressBalance === null || b.addressBalance === undefined ? 0n : unsigned(b.addressBalance, 'balance');
}

interface SimulatedGas {
  ok: boolean;
  error: string;
  computation: bigint;
  storage: bigint;
  rebate: bigint;
}

async function simulate(url: string, bytes: Uint8Array): Promise<SimulatedGas> {
  const data = await graphql(
    url,
    'query ($tx: JSON!) { simulateTransaction(transaction: $tx) { effects { status executionError { message } gasEffects { gasSummary { computationCost storageCost storageRebate } } } } }',
    { tx: { bcs: { value: base64.encode(bytes) } } },
  );
  const effects = obj(obj(data.simulateTransaction, 'simulateTransaction').effects, 'simulateTransaction');
  const gas = obj(obj(effects.gasEffects, 'simulateTransaction').gasSummary, 'simulateTransaction');
  const err = effects.executionError && typeof effects.executionError === 'object' ? (effects.executionError as { message?: unknown }).message : undefined;
  return {
    ok: effects.status === 'SUCCESS',
    error: typeof err === 'string' ? err : '',
    computation: unsigned(gas.computationCost, 'simulateTransaction'),
    storage: unsigned(gas.storageCost, 'simulateTransaction'),
    rebate: unsigned(gas.storageRebate, 'simulateTransaction'),
  };
}

/** A simulation that failed for want of funds is `funds`; any other failure is not ours to name. */
function failedSimulation(sim: SimulatedGas): never {
  if (/insufficient|balance/i.test(sim.error)) throw new ChainSwapRefused('funds');
  throw new Error(`The Sui transfer would fail: ${nodeMessage(sim.error) || 'simulation failed'}`);
}

/* ------------------------------------ send ------------------------------------ */

const randomNonce = () => crypto.getRandomValues(new Uint32Array(1))[0];

export interface SuiTransferRequest {
  /** The GraphQL service of the network in `env`. */
  url: string;
  env: ChainNet;
  sender: string;
  /** 0x + 64 lowercase hex. */
  to: string;
  coinType: string;
  amount: bigint;
  maxFee: bigint;
}

/**
 * Everything but the signature: the node's identity, what the sender holds, the plan, the
 * simulated budget, and the final bytes simulated again. Needs no key, so the same path can be
 * dry-run for any address.
 */
export async function prepareSuiTransfer(r: SuiTransferRequest): Promise<{ bytes: Uint8Array; budget: bigint }> {
  const { url, sender, coinType } = r;
  const native = coinType === SUI_COIN_TYPE;
  const data = await graphql(
    url,
    `query ($owner: SuiAddress!, $sui: String!, $suiObj: String!, $tok: String!, $tokObj: String!) {
      chainIdentifier
      epoch { epochId referenceGasPrice }
      address(address: $owner) {
        sui: balance(coinType: $sui) { addressBalance }
        tok: balance(coinType: $tok) { addressBalance }
        suiCoins: objects(first: ${SUI_COIN_PAGE_SIZE}, filter: { type: $suiObj }) { ${COIN_FIELDS} }
        tokCoins: objects(first: ${SUI_COIN_PAGE_SIZE}, filter: { type: $tokObj }) { ${COIN_FIELDS} }
      }
    }`,
    { owner: sender, sui: SUI_COIN_TYPE, suiObj: coinObjectType(SUI_COIN_TYPE), tok: coinType, tokObj: coinObjectType(coinType) },
  );
  // The node must be the network the signature will be bound to (`ValidDuring.chain`).
  const chain = SUI_CHAIN_ID[r.env];
  if (data.chainIdentifier !== chain) throw new ChainSwapRefused('chain');
  const epochInfo = obj(data.epoch, 'epoch');
  const epoch = unsigned(epochInfo.epochId, 'epoch');
  const price = unsigned(epochInfo.referenceGasPrice, 'epoch');
  if (price === 0n) throw shapeError('epoch');

  const account = obj(data.address, 'address');
  const sui: SuiHoldings = { coins: await allCoins(url, sender, SUI_COIN_TYPE, readCoins(account.suiCoins)), addressBalance: readBalance(account.sui) };
  const token: SuiHoldings = native ? sui : { coins: await allCoins(url, sender, coinType, readCoins(account.tokCoins)), addressBalance: readBalance(account.tok) };
  const suiHeld = total(sui.coins) + sui.addressBalance;
  const assetHeld = total(token.coins) + token.addressBalance;
  // Nothing at all: the address has never been sent anything it could pay with.
  if (suiHeld === 0n && assetHeld === 0n) throw new ChainSwapRefused('unfunded');

  // Simulate first with the most the send may cost — or what is left after the amount, if less.
  const spare = native ? suiHeld - r.amount : suiHeld;
  const minBudget = SUI_MIN_BUDGET_UNITS * price;
  if (r.maxFee < minBudget) throw new ChainSwapRefused('fee');
  if (spare < minBudget || (!native && assetHeld < r.amount)) throw new ChainSwapRefused('funds');
  const trial = r.maxFee < spare ? r.maxFee : spare;
  const nonce = randomNonce();
  const plan = (budget: bigint) => planSuiTransfer({ sender, to: r.to, amount: r.amount, coinType, sui, token, price, budget, epoch, chain, nonce });

  const trialTx = plan(trial);
  if (!trialTx) throw new ChainSwapRefused('funds');
  const sim = await simulate(url, suiTxBytes(trialTx));
  if (!sim.ok) failedSimulation(sim);

  // The Sui SDK's budget: computation plus the safety overhead, plus storage net of its rebate.
  // Whatever the node's simulation says, one send never costs more than maxFee.
  const floor = sim.computation + SUI_GAS_SAFE_OVERHEAD * price;
  const net = floor + sim.storage - sim.rebate;
  const budget = net > floor ? net : floor;
  if (budget > r.maxFee) throw new ChainSwapRefused('fee');
  if (budget > trial) throw new ChainSwapRefused('funds');

  const finalTx = plan(budget);
  if (!finalTx) throw new ChainSwapRefused('funds');
  const bytes = suiTxBytes(finalTx);
  // The exact bytes to be signed are the ones the network just ran.
  const check = await simulate(url, bytes);
  if (!check.ok) failedSimulation(check);
  return { bytes, budget };
}

/**
 * Pay `amount` of SUI (MIST) or of a registry token from our address to `to`. Answers the
 * transaction digest once the network has executed it.
 */
export async function sendSui(p: FamilyTransfer): Promise<string> {
  const source = p.def.balance;
  if (NETWORKS[p.network].address !== 'sui' || source?.kind !== 'sui') throw new ChainSwapRefused('chain');
  // Only the coin and the registry's own coin types: a type the screen never listed is not paid.
  const coinType = p.asset === 'native' ? SUI_COIN_TYPE : p.def.tokens.find((t) => t.asset === p.asset)?.asset;
  if (!coinType) throw new ChainSwapRefused('address');
  if (!isSuiAddress(p.network, p.to, p.env)) throw new ChainSwapRefused('address');
  // A coin transfer has nowhere to carry a memo; a deposit that needs one is not paid without it.
  if ((p.memo?.trim() ?? '') !== '') throw new ChainSwapRefused('memo');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  if (p.amount >= 1n << 64n) throw new ChainSwapRefused('funds');

  const sender = suiAddressOf(ed25519.getPublicKey(p.secret));
  if (p.owner.toLowerCase() !== sender) throw new Error('The Sui key does not control the address it would sign for');
  const url = source.graphql;
  const { bytes } = await prepareSuiTransfer({ url, env: p.env, sender, to: p.to.toLowerCase(), coinType, amount: p.amount, maxFee: p.maxFee });

  const { signature, digest } = signSuiTx(bytes, p.secret);
  const done = await graphql(
    url,
    'mutation ($tx: Base64!, $sigs: [Base64!]!) { executeTransaction(transactionDataBcs: $tx, signatures: $sigs) { effects { digest status executionError { message } } } }',
    { tx: base64.encode(bytes), sigs: [signature] },
    SUI_EXECUTE_TIMEOUT_MS,
  );
  const effects = obj(obj(done.executeTransaction, 'executeTransaction').effects, 'executeTransaction');
  if (effects.digest !== digest) throw new Error('Sui executeTransaction answered another transaction');
  if (effects.status !== 'SUCCESS') throw new Error('The Sui transfer failed on chain');
  return digest;
}
