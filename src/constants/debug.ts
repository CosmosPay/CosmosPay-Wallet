/**
 * The debug navigator's test wallet (`app/DebugNav.tsx`, mounted only in a dev build). The
 * phrase is SEP-5's published test vector — a public account nobody keeps real funds on — and
 * the password only seals it in this browser, so neither is a secret. Only the navigator
 * imports this module, so a production build never contains it.
 */
export const DEBUG_WALLET_PHRASE = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
export const DEBUG_WALLET_PASSWORD = 'debug-wallet-pass';
export const DEBUG_WALLET_NAME = 'Debug';

/**
 * localStorage key of the navigator's own state (`{ reopen, last }`). Deliberately not under
 * `cosmos.`: it is no wallet preference, and the extension's storage migration must not move it.
 */
export const DEBUG_NAV_KEY = 'cosmos-debug-nav';
