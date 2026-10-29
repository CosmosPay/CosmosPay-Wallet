/**
 * The Solana and Monad JSON-RPC calls the wallet makes — balances, simulation, fees,
 * nonces and broadcasts — against the node `lib/endpoints.ts` resolves for each network.
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
import { CHAIN_RPC_TIMEOUT_MS, type ChainNet } from '@/constants/chains';
import { chainRpcUrl, testnetRpcUrl } from '@/lib/endpoints';
import { balanceOfCalldata } from '@/lib/evmTx';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
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

/** Every token account `owner` holds, under both token programs. */
export async function solanaTokenAccounts(owner: string, net: ChainNet = 'mainnet'): Promise<{ address: string; mint: string; amount: bigint }[]> {
  const lists = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      sol<{ value: { pubkey: string; account: NonNullable<RawAccount> }[] }>('getTokenAccountsByOwner', [
        owner,
        { programId },
        { encoding: 'base64', commitment: 'confirmed' },
      ], net),
    ),
  );
  return lists.flatMap((l) =>
    l.value.flatMap(({ pubkey, account }) => {
      const token = decodeTokenAccount(base64.decode(account.data[0]));
      return token ? [{ address: pubkey, mint: token.mint, amount: token.amount }] : [];
    }),
  );
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

/** Whether Solana mainnet would accept `blockhash` as recent — i.e. a signature over it is spendable there. */
export async function solanaBlockhashValid(blockhash: string): Promise<boolean> {
  const r = await sol<{ value: boolean }>('isBlockhashValid', [blockhash, { commitment: 'processed' }]);
  return r.value === true;
}

export async function solanaBlockhash(net: ChainNet = 'mainnet'): Promise<string> {
  const r = await sol<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }], net);
  return r.value.blockhash;
}

/** Broadcast a signed transaction; answers its id. Preflight runs, so a doomed one is refused here. */
export async function solanaSend(signed: Uint8Array, net: ChainNet = 'mainnet'): Promise<string> {
  return sol<string>('sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }], net);
}

/* -------------------------------- Monad --------------------------------- */

const mon = <T>(method: string, params: unknown[], net: ChainNet = 'mainnet') =>
  rpc<T>(chainRpcUrl('monad', net), method, params);
const hexQty = (n: bigint) => `0x${n.toString(16)}`;

export async function monadChainId(net: ChainNet = 'mainnet'): Promise<number> {
  return Number(BigInt(await mon<string>('eth_chainId', [], net)));
}

export async function monadBalance(owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  return BigInt(await mon<string>('eth_getBalance', [owner, 'latest'], net));
}

export async function monadTokenBalance(token: string, owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  const out = await mon<string>('eth_call', [{ to: token, data: balanceOfCalldata(owner) }, 'latest'], net);
  return out && out !== '0x' ? BigInt(out) : 0n;
}

export async function monadNonce(owner: string, net: ChainNet = 'mainnet'): Promise<bigint> {
  return BigInt(await mon<string>('eth_getTransactionCount', [owner, 'pending'], net));
}

/** `maxPriorityFeePerGas` and the latest block's base fee. */
export async function monadFees(net: ChainNet = 'mainnet'): Promise<{ tip: bigint; baseFee: bigint }> {
  const [tip, block] = await Promise.all([
    mon<string>('eth_maxPriorityFeePerGas', [], net),
    mon<{ baseFeePerGas?: string }>('eth_getBlockByNumber', ['latest', false], net),
  ]);
  return { tip: BigInt(tip), baseFee: BigInt(block.baseFeePerGas ?? '0x0') };
}

export async function monadEstimateGas(
  call: { from: string; to: string; data: string; value: bigint },
  net: ChainNet = 'mainnet',
): Promise<bigint> {
  return BigInt(await mon<string>('eth_estimateGas', [{ ...call, value: hexQty(call.value) }], net));
}

export async function monadSend(raw: string, net: ChainNet = 'mainnet'): Promise<string> {
  return mon<string>('eth_sendRawTransaction', [raw], net);
}

/** true / false once mined (status 1 / 0), null while pending. */
export async function monadReceipt(hash: string, net: ChainNet = 'mainnet'): Promise<boolean | null> {
  const r = await mon<{ status?: string } | null>('eth_getTransactionReceipt', [hash], net);
  return r ? r.status === '0x1' : null;
}

/* ------------------------- any EVM or SVM network ------------------------- */
// The same calls against a node the caller names — the registry's (`constants/networks.ts`) for
// the networks beyond Solana and Monad. The node is trusted for state and relaying only, as above,
// and `lib/networkSend.ts` checks it serves the chain id a transaction is signed for.

export async function evmChainIdAt(url: string): Promise<number> {
  return Number(BigInt(await rpc<string>(url, 'eth_chainId', [])));
}

export async function evmNonceAt(url: string, owner: string): Promise<bigint> {
  return BigInt(await rpc<string>(url, 'eth_getTransactionCount', [owner, 'pending']));
}

/** `maxPriorityFeePerGas` and the latest block's base fee. */
export async function evmFeesAt(url: string): Promise<{ tip: bigint; baseFee: bigint }> {
  const [tip, block] = await Promise.all([
    rpc<string>(url, 'eth_maxPriorityFeePerGas', []),
    rpc<{ baseFeePerGas?: string }>(url, 'eth_getBlockByNumber', ['latest', false]),
  ]);
  return { tip: BigInt(tip), baseFee: BigInt(block.baseFeePerGas ?? '0x0') };
}

export async function evmEstimateGasAt(url: string, call: { from: string; to: string; data: string; value: bigint }): Promise<bigint> {
  return BigInt(await rpc<string>(url, 'eth_estimateGas', [{ ...call, value: hexQty(call.value) }]));
}

export async function evmSendAt(url: string, raw: string): Promise<string> {
  return rpc<string>(url, 'eth_sendRawTransaction', [raw]);
}

export async function svmLamportsAt(url: string, owner: string): Promise<bigint> {
  const r = await rpc<{ value: number }>(url, 'getBalance', [owner, { commitment: 'confirmed' }]);
  return BigInt(r.value);
}

export async function svmGenesisAt(url: string): Promise<string> {
  return rpc<string>(url, 'getGenesisHash', []);
}

export async function svmBlockhashAt(url: string): Promise<string> {
  const r = await rpc<{ value: { blockhash: string } }>(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.value.blockhash;
}

/** Broadcast a signed transaction; answers its id. Preflight runs, so a doomed one is refused here. */
export async function svmSendAt(url: string, signed: Uint8Array): Promise<string> {
  return rpc<string>(url, 'sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
}
