/** App-shell constants: module-level literals moved out of
 *  src/app/WalletApp.tsx and src/app/ApprovePopup.tsx. */

// NAV_SCREENS moved to src/lib/screens.ts, where it is DERIVED from the screen
// table (`nav: true`) instead of being a second hand-maintained list of the same
// screens — the two had already drifted apart from `back()`'s `containers` array.

/**
 * Identity strings. These were a seven-line `config` module under `lib/`, which held
 * no behaviour at all — data belongs here, and `lib/` is for things that do something.
 *
 * `APP_VERSION` is DERIVED, not written: `__APP_VERSION__` is replaced at build time
 * with package.json's version (Vite `define`, see astro.config.ts; declared in
 * src/env.d.ts). Do not put a literal back here. It was one twice — 1.1.0 against a
 * 1.2.3 package.json, then 1.2.3 against 1.2.4 — because the release bot bumps
 * package.json and nothing bumped this file. The test that was supposed to pin them
 * could not see it either: it runs in the release workflow's `verify` job, which
 * evaluates the tree BEFORE the bump, so it passed at release time and then failed for
 * whoever pushed next, blocking every release until someone hand-edited a string.
 * A derived value has no second copy to drift, and it carries the `-dev.<run>`
 * prerelease suffix that a committed literal cannot.
 */
export const APP_NAME = 'Cosmos Pay';
export const APP_VERSION = __APP_VERSION__;
export const APP_PRODUCER = 'Un producto de Cosmos';

/**
 * What the wallet signs its own transactions with when the memo field is free —
 * `Cosmos Wallet v1.5.0` (see `defaultMemoText` in lib/memo.ts).
 *
 * Not `APP_NAME`: this is on-chain, permanent and read by strangers, and what it has
 * to answer there is "which CLIENT built this transaction", not which product family
 * it belongs to. `Cosmos Pay` is also the name of the payments API, so a memo carrying
 * it would attribute a wallet's payment to the gateway.
 *
 * Its length is load-bearing. A text memo is 28 BYTES, and this plus ` v` plus a
 * semver leaves nine bytes of headroom — enough for `v10.20.30`. A longer label would
 * silently start truncating the VERSION, which is the half worth having.
 */
export const MEMO_SIGNATURE = 'Cosmos Wallet';

/** Terms & Conditions of use — linked from the backup consent checkbox. Served by
 *  the Developer Platform (a separate repo, EN/ES). */
export const TERMS_URL = 'https://dev.cosmospay.lat/tos';

/** Splash intro timing: the app starts fading in at REVEAL and the splash
 *  overlay unmounts at DONE. DONE - REVEAL = 800ms, paired with the 0.8s ease
 *  opacity/transform transition on `.wallet-app-intro` (and the 0.75s fade on
 *  `.splash-overlay`) in src/styles/app/wallet-app.css — keep in sync. */
export const SPLASH_REVEAL_MS = 1300;
export const SPLASH_DONE_MS = 2100;

/**
 * Idle auto-lock. While unlocked, the store holds the decrypted Stellar secret AND
 * the app password in memory, so an unattended session is a spendable session — the
 * MV3 popup dies on close, but the side panel, the web build and the native app all
 * stay alive indefinitely. AUTO_LOCK_MS of no interaction drops the session; the
 * check runs on an interval rather than re-arming a timeout per input event.
 */
export const AUTO_LOCK_MS = 5 * 60_000;
export const AUTO_LOCK_CHECK_MS = 15_000;

/* The dapp surface's data — the mirror key, the approval window's title and operation
   labels, and the web transport's wire constants — moved to src/constants/dapp.ts. It
   is one area with four readers (the approval window, lib/dappOrigins.ts,
   lib/webSigner.ts and public/cosmos-wallet.js), and this file is the app SHELL's. */
