/** Static data for the extras screens (ScanQR, AddAsset, …).
 *  Extracted from src/features/extras/ — values must not change. */

/* ------------------------------ ScanQR ------------------------------ */
/** Cap the decode working size (perf) while keeping enough pixels for dense codes. */
export const SCAN_DECODE_MAX_PX = 1400;
// The memo limit lives in src/lib/memo.ts (MEMO_TEXT_MAX_BYTES): Stellar caps text
// memos at 28 BYTES, not characters, so it needs a clamp function, not a constant.

/* ----------------------------- AddAsset ----------------------------- */
// Issuer identity lives in the asset registry (src/lib/assetRegistry.ts), which is
// checked against live Horizon. `KNOWN_ISSUERS` used to sit here as a second,
// hand-maintained copy and the two had already diverged — the registry gained
// USDT0 and this table had not, so the portfolio priced Tether's token at nothing
// while the picker showed it as verified. One question, one answer: it is gone.

// Common asset codes offered in the quick list; the issuer is resolved per network,
// so each one only shows up when it actually exists on the current network (USDB is
// testnet-only, so it appears only there).
export const COMMON_CODES = ['USDC', 'USDB', 'EURC', 'AQUA', 'yXLM', 'MGUSD', 'USDY', 'YLDS', 'AUDD', 'GYEN', 'ZUSD', 'ARST', 'BRL'];

/** Stellar asset codes are 1–12 characters. */
export const ASSET_CODE_MAX = 12;
