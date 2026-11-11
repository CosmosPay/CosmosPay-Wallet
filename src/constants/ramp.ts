/**
 * Buying and selling with local money through P2P counterparts, over the Cosmos Pay API
 * (`/v1/onramp/p2p` for a purchase, `/v1/offramp/p2p` for a sale; `src/lib/p2pRamp.ts`,
 * screen `src/features/fiat/Ramp.tsx`). The API reads the marketplace, prices the order and
 * records it; the hosted window it answers takes the order. The marketplace is never named
 * in the wallet's copy.
 */

/** A purchase (local money in, a token out) or a sale (a token in, local money out). */
export const RAMP_SIDES = ['buy', 'sell'] as const;
export type RampSide = (typeof RAMP_SIDES)[number];

/** The currency a first visit starts on when the market offers it (the wallet's first market). */
export const RAMP_DEFAULT_CURRENCY = 'ARS';

/** The firm quote follows the order a moment after the last keystroke, like the swap's. */
export const RAMP_QUOTE_DEBOUNCE_MS = 450;

/** The token sheet's search waits this long after a keystroke before asking the API. */
export const RAMP_SEARCH_DEBOUNCE_MS = 250;

/** Tokens per page in the token sheet (the API's default and the most it sends is 200). */
export const RAMP_TOKENS_PAGE = 100;

/** Orders listed under the form, newest first. */
export const RAMP_SESSIONS_PAGE = 20;

/** Local money is entered with at most this many decimals (the API's rule for a purchase). */
export const RAMP_FIAT_DECIMALS = 2;

/** Whole digits an amount may have, local money or token alike (the API's own caps: 15 and 18). */
export const RAMP_FIAT_MAX_DIGITS = 15;
export const RAMP_TOKEN_MAX_DIGITS = 18;

/**
 * USD stablecoins, worth a dollar when the marketplace lists no price for them (its sandbox's
 * test USDT has none). Anything else without a price has no estimate rather than a guess.
 */
export const RAMP_USD_STABLES: readonly string[] = ['USDT', 'USDT0', 'USDC', 'USDC.e', 'DAI', 'USDS'];

/** The zero address: a chain's own coin in the marketplace's token lists. */
export const RAMP_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

/**
 * The origins the hosted window that takes an order may be on, per mode: the P2P marketplace's
 * widget (El Dorado's; code may name it, copy never does). A session whose window is anywhere
 * else is refused, and so is an order in the list. A new marketplace host is a wallet release.
 */
export const RAMP_WINDOW_ORIGINS: Record<'mainnet' | 'testnet', readonly string[]> = {
  mainnet: ['https://widget.eldorado.io'],
  testnet: ['https://widget-testnet.eldorado.io'],
};

/** The query parameter the window reads a purchase's fixed recipient from. */
export const RAMP_WINDOW_ADDRESS_PARAM = 'address';
