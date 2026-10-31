/**
 * Sections of the wallet that can be switched off without touching their code.
 *
 * Investing — the Earn tab, its DeFindex vaults and the liquidity pools — is off for now
 * (2026-10-29). Off, nothing leads there: no tab in any bar (phone, desktop rail, extension
 * menu), no `/earn` link, and neither the browser's history nor a kept session lands on one
 * of its screens (`isScreenOn` in lib/screens.ts). Setting it back to `true` restores all of
 * it as it was.
 */
export const EARN_ENABLED = false;
