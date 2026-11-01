/**
 * The swap form's tokens and routes, as pure functions (tests/unit/swapCatalog.test.ts) — the
 * developer platform's swap catalogue (its swap-catalog module), shaped for a wallet that
 * pays from its own addresses and receives on them.
 *
 * Tokens come from two sources. Stellar, Solana and Monad have their own market for swaps within
 * the chain (the Stellar DEX, Jupiter, Kuru Flow): Stellar's on both networks, Solana's and
 * Monad's on mainnet only. NEAR Intents lists what it swaps between chains (mainnet assets,
 * priced) — and within any chain without a market of its own. A token records which route can
 * take it.
 *
 * A pair's route: on Stellar, Solana or Monad, both tokens on its market; otherwise NEAR Intents,
 * both tokens listed there. On a test network only Stellar's market runs (the others, and NEAR
 * Intents, are mainnet only): a test mode swaps on Stellar's test network and nowhere else.
 *
 * What the wallet can PAY with is narrower than what exists: a token on a network it signs on,
 * and — off Stellar, Solana and Monad — the coin or a registry token, the only ones its transfer
 * pays out (lib/networkSend.ts). What it can RECEIVE is anything a route reaches on a network it
 * holds an address on: the output always lands on the wallet's own address.
 */
import type { ChainNet, ChainToken } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import type { CrossChainAsset } from '@/lib/cosmospay';
import { rowMatches } from '@/lib/assetList';
import { isKnownNetwork } from '@/lib/crossChainDest';
import { isRegistryToken } from '@/lib/trackedTokens';

export interface SwapToken {
  /** Unique in the catalogue: network, symbol and issuer / mint / contract. */
  key: string;
  chain: NetworkId;
  symbol: string;
  /** Stellar issuer, SPL mint or contract; null for the network's coin. */
  contract: string | null;
  /** Who issues it, where the registry says (Stellar). */
  issuerName: string | null;
  decimals: number;
  /** NEAR Intents' indicative USD price, for an estimate before a quote. */
  priceUsd: number | null;
  /** Its NEAR Intents listing, when NEAR Intents trades it. */
  near: CrossChainAsset | null;
  /** Tradable on its chain's own market on this network. */
  dex: boolean;
}

/** The chains with a market of their own for swaps within the chain. */
export const DEX_CHAINS: readonly NetworkId[] = ['stellar', 'solana', 'monad'];

const caseless = (chain: NetworkId) => NETWORKS[chain].address === 'evm';
const sameContract = (chain: NetworkId, a: string | null, b: string | null) =>
  a === null || b === null ? a === b : caseless(chain) ? a.toLowerCase() === b.toLowerCase() : a === b;
const keyOf = (chain: string, symbol: string, contract: string | null) => `${chain}:${symbol}:${contract ?? ''}`;

/** A listing NEAR Intents still trades: priced, and not tagged as retiring ("USDT0(DEPRECATED)"). */
export function tradesOnNear(a: Pick<CrossChainAsset, 'symbol' | 'priceUsd'>): boolean {
  return typeof a.priceUsd === 'number' && a.priceUsd > 0 && !/_?\(DEPRECATED\)$/i.test(a.symbol.trim());
}

export interface CatalogInput {
  intents: readonly CrossChainAsset[] | null;
  env: ChainNet;
  /** Stellar's assets: the registry's and the ones held, XLM with a null issuer. */
  stellar: readonly { code: string; issuer: string | null; issuerName: string | null }[];
  /** Solana's and Monad's market tokens on this network (`CHAIN_TOKENS_BY_NET`). */
  chainTokens: Record<'solana' | 'monad', readonly ChainToken[]>;
}

export function buildSwapCatalog({ intents, env, stellar, chainTokens }: CatalogInput): SwapToken[] {
  const out: SwapToken[] = [];
  const add = (t: SwapToken) => {
    if (!out.some((x) => x.key === t.key)) out.push(t);
  };
  const listed = (env === 'mainnet' ? intents ?? [] : []).filter((a) => isKnownNetwork(a.chain));
  const traded = (chain: NetworkId) => listed.filter((a) => a.chain === chain && tradesOnNear(a));
  const native = (chain: NetworkId) => (a: CrossChainAsset) => a.contract === null && a.symbol === NETWORKS[chain].coin;

  // Stellar: its market, on both networks; NEAR Intents' listing where it has the same issuer.
  for (const s of stellar) {
    const match = traded('stellar').find((a) => (s.issuer === null ? native('stellar')(a) : sameContract('stellar', a.contract, s.issuer))) ?? null;
    add({ key: keyOf('stellar', s.code, s.issuer), chain: 'stellar', symbol: s.code, contract: s.issuer, issuerName: s.issuerName, decimals: 7, priceUsd: match?.priceUsd ?? null, near: match, dex: true });
  }
  // A test network stops here: the rest is mainnet.
  if (env !== 'mainnet') return out;
  for (const a of traded('stellar')) {
    add({ key: keyOf('stellar', a.symbol, a.contract), chain: 'stellar', symbol: a.symbol, contract: a.contract, issuerName: null, decimals: 7, priceUsd: a.priceUsd ?? null, near: a, dex: true });
  }

  // Solana and Monad: the market's tokens, then whatever else NEAR Intents lists there.
  for (const chain of ['solana', 'monad'] as const) {
    for (const tk of chainTokens[chain]) {
      const contract = tk.asset === 'native' ? null : tk.asset;
      const match = traded(chain).find((a) => (contract === null ? native(chain)(a) : sameContract(chain, a.contract, contract))) ?? null;
      add({ key: keyOf(chain, tk.symbol, contract), chain, symbol: tk.symbol, contract, issuerName: null, decimals: tk.decimals, priceUsd: match?.priceUsd ?? null, near: match, dex: true });
    }
    for (const a of traded(chain)) {
      if (out.some((x) => x.chain === chain && sameContract(chain, x.contract, a.contract))) continue;
      add({ key: keyOf(chain, a.symbol, a.contract), chain, symbol: a.symbol, contract: a.contract, issuerName: null, decimals: a.decimals, priceUsd: a.priceUsd ?? null, near: a, dex: true });
    }
  }

  // Every other network: NEAR Intents only.
  for (const a of listed) {
    const chain = a.chain as NetworkId;
    if (DEX_CHAINS.includes(chain) || !tradesOnNear(a)) continue;
    add({ key: keyOf(chain, a.symbol, a.contract), chain, symbol: a.symbol, contract: a.contract, issuerName: null, decimals: a.decimals, priceUsd: a.priceUsd ?? null, near: a, dex: false });
  }
  return out;
}

export type SwapRoute =
  | { kind: 'dex'; chain: NetworkId }
  | { kind: 'near' }
  | { kind: 'none'; reason: 'same-token' | 'mainnet-only' | 'unsupported' };

/** How a pair is swapped on this network, or why it cannot be. */
export function routeFor(from: SwapToken, to: SwapToken, env: ChainNet): SwapRoute {
  if (from.key === to.key) return { kind: 'none', reason: 'same-token' };
  if (from.chain === to.chain && DEX_CHAINS.includes(from.chain)) {
    if (from.dex && to.dex) return { kind: 'dex', chain: from.chain };
    return { kind: 'none', reason: 'unsupported' };
  }
  if (env !== 'mainnet') return { kind: 'none', reason: 'mainnet-only' };
  if (from.near && to.near) return { kind: 'near' };
  return { kind: 'none', reason: 'unsupported' };
}

/**
 * Whether the wallet can pay with the token: on a network it signs on (`signs`), through a route
 * that can start there — and off Stellar, Solana and Monad, only the coin or a registry token.
 */
export function canPayWith(t: SwapToken, signs: (chain: NetworkId) => boolean): boolean {
  if (!signs(t.chain) || !(t.dex || t.near)) return false;
  if (DEX_CHAINS.includes(t.chain)) return true;
  return t.contract === null || isRegistryToken(t.chain, t.contract);
}

/** What a swap from `from` can end in: the pairs `routeFor` settles, on a network with our address. */
export function receivableFrom(from: SwapToken, tokens: readonly SwapToken[], env: ChainNet, receives: (chain: NetworkId) => boolean): SwapToken[] {
  return tokens.filter((t) => receives(t.chain) && routeFor(from, t, env).kind !== 'none');
}

/** Before a quote: the output at NEAR Intents' listed prices, or null where one is missing. */
export function estimateOut(amount: number, from: SwapToken, to: SwapToken): number | null {
  if (!(amount > 0) || !from.priceUsd || !to.priceUsd) return null;
  return (amount * from.priceUsd) / to.priceUsd;
}

/** The search over a token: its symbol, its network's name, who issues it, its contract. */
export function tokenMatches(t: SwapToken, query: string, networkName: (id: NetworkId) => string): boolean {
  return rowMatches(query, [t.symbol, networkName(t.chain), t.issuerName ?? '', t.contract ?? '']);
}
