/** Swap timing constants. The quote endpoint runs a Horizon path search, so we
 *  don't poll every second — drop QUOTE_REFRESH_MS with care. */

/** Debounce after the user edits amount/assets before requesting a fresh quote. */
export const QUOTE_DEBOUNCE_MS = 500;
/** Interval between automatic quote refreshes while the swap screen is open. */
export const QUOTE_REFRESH_MS = 10000;
