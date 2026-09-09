/**
 * The dapp surface's data: what the approval window labels a request, and the wire
 * constants of the two transports a request can arrive over.
 *
 * There are two, and they are not variants of one thing:
 *
 *   extension  the content script stamps the origin, the service worker routes on an
 *              internal rid and the request itself never travels through the page.
 *              See extension-src/sw.js.
 *   web        the wallet is a page like any other, so there is no background to route
 *              through: the dapp opens the approval window itself and hands the request
 *              over by postMessage. See src/lib/webSigner.ts.
 *
 * Collected here (out of `src/constants/app.ts`, which is the app SHELL's data) because
 * every value below is read by at least two of the four files that make the surface
 * work, and a size cap or a message tag that lives next to one of its readers is a
 * value the other reader copies.
 */

/**
 * The methods a dapp may ask for. `getNetwork` and `isConnected` are deliberately NOT
 * here: they are answered by the provider from what a previous reply told it, not by
 * opening a window at a user who did not ask for one.
 */
export const DAPP_METHODS = ['getAddress', 'signTransaction', 'signMessage', 'requestPayment'] as const;

export type DappMethod = (typeof DAPP_METHODS)[number];

/** chrome.storage.local key for the service worker's read-only dapp mirror
 *  (public address + network + approved origins). The SW keeps its own copy of
 *  this literal (extension-src/sw.js `MIRROR_KEY`) — keep both in sync. */
export const DAPP_MIRROR_KEY = 'cosmos.dapp';

/**
 * Where the WEB build keeps the same grant list.
 *
 * A separate key rather than the mirror's `approvedOrigins`, because the two are not the
 * same list: the mirror is also how the service worker learns the address and network it
 * answers reads with, and the web build has no service worker to tell. Going through
 * `lib/storage.ts` puts it wherever that build keeps everything else.
 */
export const DAPP_ORIGINS_KEY = 'cosmos.dapp.origins';

/** Envelope tag on every message of the web transport, in both directions. */
export const WEB_SIGNER_TARGET = 'cosmos-wallet';

/**
 * Wire version. Bumped when a message shape changes in a way an older peer would
 * mis-read; a mismatch is a refusal rather than a best-effort parse, because the peer
 * on the other side of this one is a page that wants a signature.
 */
export const WEB_SIGNER_PROTOCOL = 1;

/** Query parameters the dapp puts on the approval window's URL. */
export const WEB_SIGNER_PARAM = {
  /** Presence selects the web transport; the extension uses `req` instead. */
  flag: 'web',
  /** The dapp's handshake nonce, echoed back in `ready`. */
  nonce: 'n',
  /** The origin the dapp claims — a POST TARGET, never an identity. See webSigner.ts. */
  origin: 'o',
} as const;

/** How long the approval window waits for the request before giving up on the dapp. */
export const WEB_REQUEST_WAIT_MS = 30_000;

/** How often the window re-announces itself while it waits, in case the dapp attached
 *  its listener after the popup had already loaded. */
export const WEB_READY_RETRY_MS = 300;

/**
 * Size caps on what a page may hand over.
 *
 * Not a security boundary — everything below is decoded and shown before it can be
 * signed — but the approval window renders these, and a megabyte of "message" is a
 * window that cannot be read and therefore cannot be judged. A transaction envelope is
 * a few hundred bytes; Soroban ones with a big footprint reach a few thousand.
 */
export const MAX_XDR_CHARS = 64 * 1024;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_URI_CHARS = 4096;
/** A correlation id is echoed back verbatim; it has no business being long. */
export const MAX_REQUEST_ID_CHARS = 128;

/** i18n keys for the dapp-approval window titles per request method (see ApprovePopup).
 *  KEYS, not copy: this file is data, and `constants/` may not import from `lib/` at
 *  runtime — so it cannot call the translator, and holding a Spanish literal here was
 *  the same thing as holding it in the component. The window resolves these. */
export const APPROVE_TITLE_KEYS: Record<DappMethod, string> = {
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
