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
