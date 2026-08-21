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

/** chrome.storage.local key for the service worker's read-only dapp mirror
 *  (public address + network + approved origins). The SW keeps its own copy of
 *  this literal (extension-src/sw.js `MIRROR_KEY`) — keep both in sync. */
export const DAPP_MIRROR_KEY = 'cosmos.dapp';

/** i18n keys for the dapp-approval window titles per request method (see ApprovePopup).
 *  KEYS, not copy: this file is data, and `constants/` may not import from `lib/` at
 *  runtime — so it cannot call the translator, and holding a Spanish literal here was
 *  the same thing as holding it in the component. The window resolves these. */
export const APPROVE_TITLE_KEYS: Record<
  'getAddress' | 'signTransaction' | 'signMessage' | 'requestPayment',
  string
> = {
  getAddress: 'approve.title.getAddress',
  signTransaction: 'approve.title.signTransaction',
  signMessage: 'approve.title.signMessage',
  requestPayment: 'approve.title.requestPayment',
};

/** i18n keys for the Stellar operations the approval window renders, in plain language.
 *  An unmapped type falls back to its raw SDK name — visible, never hidden. The
 *  `⚠️` prefix on the critical ones lives in the translation, not here. */
export const OP_LABEL_KEYS: Record<string, string> = {
  payment: 'op.payment',
  createAccount: 'op.createAccount',
  pathPaymentStrictSend: 'op.pathPaymentStrictSend',
  pathPaymentStrictReceive: 'op.pathPaymentStrictReceive',
  changeTrust: 'op.changeTrust',
  manageSellOffer: 'op.manageSellOffer',
  manageBuyOffer: 'op.manageBuyOffer',
  createPassiveSellOffer: 'op.createPassiveSellOffer',
  liquidityPoolDeposit: 'op.liquidityPoolDeposit',
  liquidityPoolWithdraw: 'op.liquidityPoolWithdraw',
  manageData: 'op.manageData',
  bumpSequence: 'op.bumpSequence',
  createClaimableBalance: 'op.createClaimableBalance',
  claimClaimableBalance: 'op.claimClaimableBalance',
  invokeHostFunction: 'op.invokeHostFunction',
  // Critical — the window renders these behind a red warning.
  setOptions: 'op.setOptions',
  accountMerge: 'op.accountMerge',
  allowTrust: 'op.allowTrust',
  setTrustLineFlags: 'op.setTrustLineFlags',
  clawback: 'op.clawback',
  clawbackClaimableBalance: 'op.clawbackClaimableBalance',
  beginSponsoringFutureReserves: 'op.beginSponsoringFutureReserves',
  endSponsoringFutureReserves: 'op.endSponsoringFutureReserves',
  revokeSponsorship: 'op.revokeSponsorship',
};
