/** Static data for the extras screens (ScanQR, AddAsset, …).
 *  Extracted from src/components/screens/extras/ — values must not change. */

/* ------------------------------ ScanQR ------------------------------ */
/** Cap the decode working size (perf) while keeping enough pixels for dense codes. */
export const SCAN_DECODE_MAX_PX = 1400;
/** Stellar text memos max out at 28 chars — trim scanned memos to fit. */
export const SCAN_MEMO_MAX = 28;

/* ----------------------------- AddAsset ----------------------------- */
// Issuers we trust outright per network; everything else is resolved from Horizon
// (so testnet variants and less-common assets get the right, real issuer).
export const KNOWN_ISSUERS: Record<string, { public?: string; testnet?: string }> = {
  USDC: {
    public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  // BlindPay's dev/test stablecoin (used by the fiat on/off-ramp) — testnet only.
  USDB: { testnet: 'GCQSSIMOW5OCGULZATDXKU5MOJBOMFX6G65X6CXZDQ7AIB3SKFUZ67NX' },
  EURC: { public: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2' },
  AQUA: { public: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA' },
  yXLM: { public: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55' },
};

// Common asset codes offered in the quick list; the issuer is resolved per network,
// so each one only shows up when it actually exists on the current network (USDB is
// testnet-only, so it appears only there).
export const COMMON_CODES = ['USDC', 'USDB', 'EURC', 'AQUA', 'yXLM', 'MGUSD', 'USDY', 'YLDS', 'AUDD', 'GYEN', 'ZUSD', 'ARST', 'BRL'];

/** Stellar asset codes are 1–12 characters. */
export const ASSET_CODE_MAX = 12;
