/** Swap timing constants. The quote endpoint runs a Horizon path search, so we
 *  don't poll every second — drop QUOTE_REFRESH_MS with care. */

/** Debounce after the user edits amount/assets before requesting a fresh quote. */
export const QUOTE_DEBOUNCE_MS = 500;
/** Interval between automatic quote refreshes while the swap screen is open. */
export const QUOTE_REFRESH_MS = 10000;

/**
 * Slippage for a cross-chain swap (1%). Wider than a Stellar path payment's: the
 * price is fixed at the quote but the swap fills after the deposit confirms, and
 * below the minimum NEAR Intents refunds rather than fills.
 */
export const CROSS_CHAIN_SLIPPAGE_BPS = 100;

/**
 * The max slippage a person may choose in the swap screens, in basis points: four presets
 * and a stepper between the two bounds. A choice replaces each venue's default above (and
 * `DEFAULT_SLIPPAGE_BPS`, `CHAIN_SWAP_SLIPPAGE_BPS`); none ("auto") keeps them. The gateway
 * caps it again with its own setting, and what bounds the signature is the quote's
 * "minimum received", which the screen shows next to it.
 */
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 250] as const;
export const SLIPPAGE_MIN_BPS = 10;
export const SLIPPAGE_MAX_BPS = 500;
/** The stepper moves 0.1% at a time below 1%, and 0.5% at a time from 1% up. */
export const SLIPPAGE_FINE_STEP_BPS = 10;
export const SLIPPAGE_COARSE_STEP_BPS = 50;
export const SLIPPAGE_COARSE_FROM_BPS = 100;
/** From here the sheet warns that the minimum received drops noticeably. */
export const SLIPPAGE_WARN_BPS = 300;

/**
 * The gateway's error code when the provider behind it (NEAR Intents, Jupiter…) refused the
 * request itself — a pair it does not quote, an amount under its minimum. A wire literal of
 * the community server's `ApiErrorCode.ProviderError`; the quote screens show a standing
 * line for it instead of a toast on every refresh.
 */
export const PROVIDER_REFUSED_CODE = 'provider_error';

/**
 * The gateway's code when the provider behind it did not answer at all (a timeout, an
 * outage) — `ApiErrorCode.ProviderUnavailable` on the community server. On a Jupiter or
 * Kuru Flow quote it is what turns the pair over to NEAR Intents (`venueFallback`).
 */
export const PROVIDER_UNAVAILABLE_CODE = 'provider_unavailable';

/**
 * What a wallet may receive on each other chain. NEAR Intents lists dozens of
 * tokens there; a wallet receiving into its own address wants the native coin and
 * the dollar stablecoins, and each symbol is matched against the live list, so one
 * NEAR Intents stops listing simply disappears.
 */
export const CROSS_CHAIN_TARGET_SYMBOLS = {
  solana: ['SOL', 'USDC', 'USDT'],
  monad: ['MON', 'USDC', 'USDT0'],
} as const;

/**
 * How often the success screen asks NEAR Intents where a swap stands. 1Click's own indexer
 * moves in seconds; five keeps the tracker live without hammering a public endpoint.
 */
export const INTENTS_POLL_MS = 5_000;
