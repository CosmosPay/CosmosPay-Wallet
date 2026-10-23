/**
 * Which venue settles a swap, and what it may land as.
 *
 * The rule is "native first, NEAR Intents for the rest": a swap that stays on a chain with
 * a venue of its own is settled there — the Stellar DEX (a path payment), Jupiter on
 * Solana, Kuru Flow on Monad — and everything else goes through NEAR Intents: every swap
 * between two chains, and a swap that stays on Ethereum, Arbitrum or Base, which have no
 * venue the gateway builds for. Bitcoin holds one asset, so it only ever swaps OUT.
 *
 * Pure on purpose: the screens and the store both ask it, and `tests/unit/swapRoute.test.ts`
 * pins the table, because a route picked wrong is a swap signed through the wrong path.
 */
import { CHAIN_TOKENS, OTHER_CHAINS, SAME_CHAIN_VENUE, isEvmChain, type ChainToken, type OtherChain } from '@/constants/chains';

/** Any end of a swap: Stellar or one of the other chains. */
export type SwapNetwork = 'stellar' | OtherChain;

export const SWAP_NETWORKS: readonly SwapNetwork[] = ['stellar', ...OTHER_CHAINS];

export type SwapRoute = 'stellar-dex' | 'jupiter' | 'kuru' | 'intents';

/** How a swap from `origin` to `target` settles, or null when there is no such swap. */
export function swapRoute(origin: SwapNetwork, target: SwapNetwork): SwapRoute | null {
  if (origin !== target) return 'intents';
  if (origin === 'stellar') return 'stellar-dex';
  return SAME_CHAIN_VENUE[origin];
}

/**
 * Where a same-chain swap goes when its venue is down: Jupiter and Kuru Flow are third
 * parties that time out, and NEAR Intents settles the same pair (the gateway takes it only
 * with `venueFallback`). The Stellar DEX has none — it is the network itself — and a route
 * that is already NEAR Intents has nowhere further to fall.
 */
export const venueFallback = (route: SwapRoute | null): SwapRoute | null =>
  route === 'jupiter' || route === 'kuru' ? 'intents' : null;

/** The networks a swap paid from `origin` may land on, `origin` first when it can. */
export function swapTargets(origin: SwapNetwork): SwapNetwork[] {
  const others = SWAP_NETWORKS.filter((n) => n !== origin);
  return swapRoute(origin, origin) ? [origin, ...others] : others;
}

/** What the gateway's NEAR Intents catalogue lists, as the wallet reads it. */
export interface IntentsAsset {
  chain: SwapNetwork | string;
  symbol: string;
  assetId: string;
  decimals: number;
  contract: string | null;
}

/** Contracts compare by case on Solana and Stellar (base58 / StrKey), never on an EVM chain. */
const sameContract = (chain: SwapNetwork, a: string, b: string) =>
  isEvmChain(chain) ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * The NEAR Intents assets a swap may land as on `target`: exactly the tokens the wallet
 * offers there (`CHAIN_TOKENS`), matched by CONTRACT — never by symbol, because a symbol is
 * not an identifier (NEAR lists `WETH` beside `ETH`, `BTC(OMNI)` beside `BTC`, and anyone
 * can name a token `USDC`). On Stellar, whatever NEAR lists there (XLM and Circle USDC),
 * which the gateway already resolves by issuer.
 */
export function intentsTargets(target: SwapNetwork, catalogue: IntentsAsset[]): IntentsAsset[] {
  const onChain = catalogue.filter((a) => a.chain === target);
  if (target === 'stellar') return onChain;
  return CHAIN_TOKENS[target]
    .map((token: ChainToken) =>
      onChain.find((a) => (token.asset === 'native' ? a.contract === null : !!a.contract && sameContract(target, a.contract, token.asset))),
    )
    .filter((a): a is IntentsAsset => !!a);
}

/**
 * Whether `token` (one of `CHAIN_TOKENS[origin]`) is something NEAR Intents can take on
 * `origin`, by the same contract rule — the only tokens a NEAR swap may be paid with.
 */
export function intentsListsToken(origin: OtherChain, token: ChainToken, catalogue: IntentsAsset[]): boolean {
  return intentsTargets(origin, catalogue).some((a) =>
    token.asset === 'native' ? a.contract === null : !!a.contract && sameContract(origin, a.contract, token.asset),
  );
}
