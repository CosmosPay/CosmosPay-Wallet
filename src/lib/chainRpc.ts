/**
 * The calls the wallet makes to the other chains' nodes — Solana and EVM JSON-RPC, and a
 * Bitcoin Esplora API: balances, simulation, fees, nonces, unspent outputs and broadcasts —
 * against the node `lib/endpoints.ts` resolves for each network.
 * Every call defaults to mainnet, which is the only network a swap uses; the test
 * networks (`net: 'testnet'`) are for test balances and test sends.
 *
 * The node is only ever asked for state and to relay what the wallet already signed.
 * It is not trusted to decide anything about the user's money beyond that: a node that
 * lied in a simulation could make a bad swap look good, which is why the gateway and the
 * wallet each read a DIFFERENT node (the gateway its own, the wallet this one) and a
 * lying one alone does not get a transaction through both.
 */
import { base64 } from '@scure/base';
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet, type EvmChain } from '@/constants/chains';
import { chainRpcUrl, testnetRpcUrl } from '@/lib/endpoints';
import { balanceOfCalldata } from '@/lib/evmTx';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  decodeTokenAccount,
  type AccountState,
} from '@/lib/solanaTx';

export class ChainRpcError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
    this.name = 'ChainRpcError';
  }
}

let nextId = 1;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new ChainRpcError(`${method}: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (body.error) throw new ChainRpcError(body.error.message || `${method} failed`, body.error.code);
    return body.result as T;
  } catch (e) {
    if (e instanceof ChainRpcError) throw e;
    throw new ChainRpcError((e as Error).name === 'AbortError' ? `${method}: timed out` : `${method}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------- Solana -------------------------------- */

const sol = <T>(method: string, params: unknown[], net: ChainNet = 'mainnet') =>
  rpc<T>(chainRpcUrl('solana', net), method, params);

type RawAccount = { lamports: number; owner: string; data: [string, string] } | null;

const toState = (a: RawAccount): AccountState =>
  a ? { lamports: BigInt(a.lamports), owner: a.owner, data: base64.decode(a.data[0]) } : null;

export async function solanaLamports(owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  const r = await sol<{ value: number }>('getBalance', [owner, { commitment: 'confirmed' }], net);
  return BigInt(r.value);
}

/**
 * What `owner` holds of each of `mints`, read from its associated token account under both
 * token programs in one `getMultipleAccounts`. Never `getTokenAccountsByOwner`: the public
 * mainnet node that answers a browser refuses it (see `DEFAULT_SOLANA_RPC_URL`). The mints
 * are the wallet's own listed tokens, whose balances live in their associated accounts.
 */
export async function solanaTokenBalances(owner: string, mints: string[], net: ChainNet = 'mainnet'): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = Object.fromEntries(mints.map((m) => [m, 0n]));
  const slots = mints.flatMap((mint) =>
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) => ({ mint, program, address: associatedTokenAddress(owner, mint, program) })),
  );
  if (!slots.length) return out;
  const r = await sol<{ value: RawAccount[] }>(
    'getMultipleAccounts',
    [slots.map((s) => s.address), { encoding: 'base64', commitment: 'confirmed' }],
    net,
  );
  slots.forEach((s, i) => {
    const raw = r.value[i];
    if (!raw || raw.owner !== s.program) return;
    const token = decodeTokenAccount(base64.decode(raw.data[0]));
    if (token && token.owner === owner && token.mint === s.mint) out[s.mint] += token.amount;
  });
  return out;
}

/** The token program that owns `mint` (SPL Token or Token-2022). */
export async function solanaMintProgram(mint: string, net: ChainNet = 'mainnet'): Promise<string> {
  const r = await sol<{ value: RawAccount }>('getAccountInfo', [mint, { encoding: 'base64' }], net);
  const program = r.value?.owner;
  if (program !== TOKEN_PROGRAM_ID && program !== TOKEN_2022_PROGRAM_ID) throw new ChainRpcError(`${mint} is not a token mint`);
  return program;
}

export async function solanaAccounts(addresses: string[]): Promise<Map<string, AccountState>> {
  const r = await sol<{ value: RawAccount[] }>('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }]);
  return new Map(addresses.map((a, i) => [a, toState(r.value[i])]));
}

/**
 * Run an unsigned transaction and read `addresses` as it would leave them. The
 * blockhash is replaced (an unsigned transaction may sit a few seconds on screen) and
 * signatures are not checked — neither changes what the transaction does.
 */
export async function solanaSimulate(
  wire: Uint8Array,
  addresses: string[],
): Promise<{ err: unknown; accounts: Map<string, AccountState> }> {
  const r = await sol<{ value: { err: unknown; accounts: RawAccount[] | null } }>('simulateTransaction', [
    base64.encode(wire),
    {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses },
    },
  ]);
  const accounts = r.value.accounts ?? [];
  return { err: r.value.err, accounts: new Map(addresses.map((a, i) => [a, toState(accounts[i] ?? null)])) };
}

export async function solanaBlockhash(net: ChainNet = 'mainnet'): Promise<string> {
  const r = await sol<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }], net);
  return r.value.blockhash;
}

/** Broadcast a signed transaction; answers its id. Preflight runs, so a doomed one is refused here. */
export async function solanaSend(signed: Uint8Array, net: ChainNet = 'mainnet'): Promise<string> {
  return sol<string>('sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }], net);
}

/* --------------------------------- EVM ---------------------------------- */
// Ethereum, Arbitrum, Base and Monad speak the same JSON-RPC; only the node and the chain
// id differ, and every caller that signs checks the chain id first (`lib/chainSwap.ts`).

const evm = <T>(chain: EvmChain, method: string, params: unknown[], net: ChainNet = 'mainnet') =>
  rpc<T>(chainRpcUrl(chain, net), method, params);
const hexQty = (n: bigint) => `0x${n.toString(16)}`;

export async function evmChainId(chain: EvmChain, net: ChainNet = 'mainnet'): Promise<number> {
  return Number(BigInt(await evm<string>(chain, 'eth_chainId', [], net)));
}

export async function evmBalance(chain: EvmChain, owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  return BigInt(await evm<string>(chain, 'eth_getBalance', [owner, 'latest'], net));
}

export async function evmTokenBalance(chain: EvmChain, token: string, owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  const out = await evm<string>(chain, 'eth_call', [{ to: token, data: balanceOfCalldata(owner) }, 'latest'], net);
  return out && out !== '0x' ? BigInt(out) : 0n;
}

export async function evmNonce(chain: EvmChain, owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  return BigInt(await evm<string>(chain, 'eth_getTransactionCount', [owner, 'pending'], net));
}

/** `maxPriorityFeePerGas` and the latest block's base fee. */
export async function evmFees(chain: EvmChain, net: ChainNet = 'mainnet'): Promise<{ tip: bigint; baseFee: bigint }> {
  const [tip, block] = await Promise.all([
    evm<string>(chain, 'eth_maxPriorityFeePerGas', [], net),
    evm<{ baseFeePerGas?: string }>(chain, 'eth_getBlockByNumber', ['latest', false], net),
  ]);
  return { tip: BigInt(tip), baseFee: BigInt(block.baseFeePerGas ?? '0x0') };
}

export async function evmEstimateGas(
  chain: EvmChain,
  call: { from: string; to: string; data: string; value: bigint },
  net: ChainNet = 'mainnet',
): Promise<bigint> {
  return BigInt(await evm<string>(chain, 'eth_estimateGas', [{ ...call, value: hexQty(call.value) }], net));
}

export async function evmSend(chain: EvmChain, raw: string, net: ChainNet = 'mainnet'): Promise<string> {
  return evm<string>(chain, 'eth_sendRawTransaction', [raw], net);
}

/** true / false once mined (status 1 / 0), null while pending. */
export async function evmReceipt(chain: EvmChain, hash: string, net: ChainNet = 'mainnet'): Promise<boolean | null> {
  const r = await evm<{ status?: string } | null>(chain, 'eth_getTransactionReceipt', [hash], net);
  return r ? r.status === '0x1' : null;
}

/* -------------------------------- Bitcoin -------------------------------- */
// An Esplora REST API (mempool.space by default), not JSON-RPC: a Bitcoin node exposes no
// address index, and an indexer is what answers "what can this address spend".

async function esplora<T>(net: ChainNet, path: string, init?: { method: 'POST'; body: string }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(`${chainRpcUrl('bitcoin', net)}${path}`, {
      method: init?.method ?? 'GET',
      headers: init ? { 'content-type': 'text/plain' } : undefined,
      body: init?.body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ChainRpcError(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`.trim(), res.status);
    // A broadcast answers the bare txid as text; everything else is JSON.
    return (init ? text.trim() : JSON.parse(text)) as T;
  } catch (e) {
    if (e instanceof ChainRpcError) throw e;
    throw new ChainRpcError((e as Error).name === 'AbortError' ? `${path}: timed out` : `${path}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** An output this address can spend. `value` in sats. */
export interface BitcoinUtxo {
  txid: string;
  vout: number;
  value: bigint;
  confirmed: boolean;
}

/** The balance (sats): confirmed and unconfirmed, received less spent, as Esplora counts it. */
export async function bitcoinBalance(address: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  type Stats = { funded_txo_sum: number; spent_txo_sum: number };
  const r = await esplora<{ chain_stats: Stats; mempool_stats: Stats }>(net, `/address/${encodeURIComponent(address)}`);
  const sum = (s: Stats) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  const total = sum(r.chain_stats) + sum(r.mempool_stats);
  return total > 0n ? total : 0n;
}

export async function bitcoinUtxos(address: string, net: ChainNet = 'mainnet'): Promise<BitcoinUtxo[]> {
  const list = await esplora<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }[]>(
    net,
    `/address/${encodeURIComponent(address)}/utxo`,
  );
  return list.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: !!u.status?.confirmed }));
}

/**
 * The fee rate (sat/vB) for confirmation within about half an hour. mempool.space's
 * `/v1/fees/recommended` first; a plain Esplora's `/fee-estimates` (target in blocks →
 * rate) when the first is not there.
 */
export async function bitcoinFeeRate(net: ChainNet = 'mainnet'): Promise<number> {
  try {
    const r = await esplora<{ halfHourFee?: number; fastestFee?: number }>(net, '/v1/fees/recommended');
    const rate = r.halfHourFee ?? r.fastestFee;
    if (typeof rate === 'number' && Number.isFinite(rate)) return rate;
  } catch {
    /* not mempool.space — fall through to the Esplora standard */
  }
  const est = await esplora<Record<string, number>>(net, '/fee-estimates');
  const rate = est['3'] ?? est['6'] ?? est['2'] ?? est['1'];
  if (typeof rate !== 'number' || !Number.isFinite(rate)) throw new ChainRpcError('fee-estimates: no rate');
  return rate;
}

/** Broadcast a signed transaction (raw hex); answers its txid. */
export async function bitcoinBroadcast(rawHex: string, net: ChainNet = 'mainnet'): Promise<string> {
  return esplora<string>(net, '/tx', { method: 'POST', body: rawHex });
}

/* ----------------------------- test networks ----------------------------- */
// The devnet airdrop. Nothing here signs — a faucet needs only the address it pays.

/** Ask Solana devnet to airdrop `lamports` to `owner`; answers the transaction signature. */
export async function solanaDevnetAirdrop(owner: string, lamports: bigint): Promise<string> {
  return rpc<string>(testnetRpcUrl('solana'), 'requestAirdrop', [owner, Number(lamports), { commitment: 'confirmed' }]);
}

/** true once devnet reports `signature` confirmed, false if it failed, null while pending. */
export async function solanaDevnetConfirmed(signature: string): Promise<boolean | null> {
  const r = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(
    testnetRpcUrl('solana'),
    'getSignatureStatuses',
    [[signature]],
  );
  const status = r.value[0];
  if (!status) return null;
  if (status.err) return false;
  return status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized' ? true : null;
}
