/** App-shell constants: module-level literals moved out of
 *  src/components/WalletApp.tsx and src/components/ApprovePopup.tsx. */

/** Screens that show the bottom navigation bar (when a session is open). */
export const NAV_SCREENS = ['home', 'earn', 'markets', 'profile', 'swap'];

/** Splash intro timing: the app starts fading in at REVEAL and the splash
 *  overlay unmounts at DONE. DONE - REVEAL = 800ms, paired with the 0.8s ease
 *  opacity/transform transition on `.wallet-app-intro` (and the 0.75s fade on
 *  `.splash-overlay`) in src/styles/components/wallet-app.css — keep in sync. */
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
  invokeHostFunction: 'Invocar contrato (Soroban)',
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
