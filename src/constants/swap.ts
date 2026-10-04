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
 * What a wallet may receive on each other chain. NEAR Intents lists dozens of
 * tokens there; a wallet receiving into its own address wants the native coin and
 * the dollar stablecoins, and each symbol is matched against the live list, so one
 * NEAR Intents stops listing simply disappears.
 */
export const CROSS_CHAIN_TARGET_SYMBOLS = {
  solana: ['SOL', 'USDC', 'USDT'],
  monad: ['MON', 'USDC', 'USDT0'],
} as const;
