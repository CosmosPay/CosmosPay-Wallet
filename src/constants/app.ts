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

/** Dapp-approval window titles per request method (see ApprovePopup). */
export const APPROVE_TITLES: Record<
  'getAddress' | 'signTransaction' | 'signMessage' | 'requestPayment',
  string
> = {
  getAddress: 'Conectar tu wallet',
  signTransaction: 'Firmar transacción',
  signMessage: 'Firmar mensaje',
  requestPayment: 'Enviar pago',
};

/** Plain-language names for the Stellar operations the approval window renders.
 *  An unmapped type falls back to its raw SDK name — visible, never hidden. */
export const OP_LABELS: Record<string, string> = {
  payment: 'Pago',
  createAccount: 'Crear cuenta',
  pathPaymentStrictSend: 'Intercambio (envío fijo)',
  pathPaymentStrictReceive: 'Intercambio (recepción fija)',
  changeTrust: 'Añadir/quitar activo (trustline)',
  manageSellOffer: 'Orden de venta',
  manageBuyOffer: 'Orden de compra',
  createPassiveSellOffer: 'Orden de venta pasiva',
  liquidityPoolDeposit: 'Depósito en pool de liquidez',
  liquidityPoolWithdraw: 'Retiro de pool de liquidez',
  manageData: 'Escribir dato en la cuenta',
  bumpSequence: 'Avanzar número de secuencia',
  createClaimableBalance: 'Crear saldo reclamable',
  claimClaimableBalance: 'Reclamar saldo',
  invokeHostFunction: '⚠️ INVOCAR CONTRATO (SOROBAN) — CONTENIDO NO LEGIBLE',
  // Critical — the window renders these behind a red warning.
  setOptions: '⚠️ CAMBIAR FIRMANTES / UMBRALES DE TU CUENTA',
  accountMerge: '⚠️ FUSIONAR (VACIAR) TU CUENTA',
  allowTrust: '⚠️ Cambiar autorización de trustline',
  setTrustLineFlags: '⚠️ Cambiar flags de trustline',
  clawback: '⚠️ Clawback de activos',
  clawbackClaimableBalance: '⚠️ Clawback de saldo reclamable',
  beginSponsoringFutureReserves: '⚠️ Iniciar patrocinio de reservas',
  endSponsoringFutureReserves: '⚠️ Finalizar patrocinio de reservas',
  revokeSponsorship: '⚠️ Revocar patrocinio',
};
