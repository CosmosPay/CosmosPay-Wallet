/**
 * El Dorado: a P2P marketplace that sells stablecoins for local money (bank transfer, PIX,
 * Nequi, Yape, Zelle…) and delivers them on Arbitrum. The wallet reads its public market
 * data and opens its hosted widget with the order filled in (`src/lib/eldorado.ts`); the
 * order, the El Dorado login and its KYC all happen in the widget, never in the wallet.
 *
 * Each mode is a pair: the public API and the widget that takes the order. Test mode uses
 * both test hosts, where the only asset is El Dorado's own test USDT on Arbitrum Sepolia:
 * any other token or chain fails the order there (their sandbox guide, read 2026-11-05).
 *
 * The provider is never named in the wallet's copy (the developer platform's rule,
 * "Never name a provider"); its widget carries its own brand.
 */
import type { ChainNet } from '@/constants/chains';
import type { NetworkToken } from '@/constants/networks';

export interface EldoradoEnv {
  /** Public REST API; currencies, payment methods and prices need no credentials. */
  api: string;
  /** Hosted widget; `/exchange` takes the order parameters. */
  widget: string;
  /** EIP-155 id the stablecoin is delivered on. */
  chainId: number;
}

export const ELDORADO_ENV: Record<ChainNet, EldoradoEnv> = {
  mainnet: { api: 'https://api.eldorado.io/api', widget: 'https://widget.eldorado.io', chainId: 42161 },
  testnet: { api: 'https://api-testnet.eldorado.io/api', widget: 'https://widget-testnet.eldorado.io', chainId: 421614 },
};

/** The test token the sandbox delivers (18 decimals, unlike real USDT). */
export const ELDORADO_TEST_USDT: NetworkToken = {
  symbol: 'USDT',
  asset: '0x25f5D414F85b7f4668ADe4E557ef234023208771',
  decimals: 18,
};

/** The wallet's network the stablecoin lands on: its Arbitrum account (`src/constants/networks.ts`). */
export const ELDORADO_NETWORK = 'arb' as const;

/** The market is read once per visit; a slow answer is cut here rather than hanging the form. */
export const ELDORADO_TIMEOUT_MS = 12_000;

/** The currency a first visit starts on, when the market offers it (the wallet's first market). */
export const ELDORADO_DEFAULT_CURRENCY = 'ARS';

/**
 * The widget reads a fixed receiving address from `address` (a 0x account, checked on its
 * side with /^0x[a-fA-F0-9]{40}$/) and then treats the wallet as connected with it, so the
 * person never connects another wallet. Undocumented: found in the widget's bundle on
 * 2026-11-05 (`useExternalWalletAddress`). The documented parameters are the rest.
 */
export const ELDORADO_ADDRESS_PARAM = 'address';

/** `externalReferenceId` allows letters, digits and hyphens only; ours start with this. */
export const ELDORADO_REFERENCE_PREFIX = 'cw';
