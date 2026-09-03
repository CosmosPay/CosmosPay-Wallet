/**
 * Pollar protocol facts and the wallet's own policy for them. Data only — the client
 * is `src/lib/pollar.ts` (the CosmosPay bridge) and `src/lib/pollarApi.ts` (Pollar's
 * own SDK API, which the wallet calls directly once it holds a session).
 *
 * The numbers here are the wallet's half of a contract whose other half lives in the
 * community server's own Pollar constants module (a separate repository). Where both
 * name the same fact the server is authoritative and this file is a client-side echo
 * chosen to stay inside it — see POLL_INTERVAL_MS and AUTHORIZE_BUDGET below. Nothing
 * checks the two agree, so treat a change here as a change that needs the server read.
 */

/** The hosted providers the bridge serves. Mirrors POLLAR_OAUTH_PROVIDERS server-side. */
export const POLLAR_PROVIDERS = ['google', 'github'] as const;
export type PollarProvider = (typeof POLLAR_PROVIDERS)[number];

/**
 * Gap between polls of `GET /v1/pollar/oauth/sessions/{state}`.
 *
 * Two seconds, not the server's own 500 ms: that one paces the bridge's internal wait
 * for Pollar to report READY, which happens inside one request. This is a human
 * finishing a consent screen in another window, which takes tens of seconds, and every
 * poll here costs a round trip from a phone. The route's budget is 60 per ten minutes
 * and it is shared with the callback, so 2 s leaves a login able to run for its full
 * five-minute handshake TTL without ever approaching the cap.
 */
export const POLL_INTERVAL_MS = 2000;

/**
 * How long the wallet keeps polling before it gives up on its own.
 *
 * Slightly under the bridge's `POLLAR_AUTHORIZATION_TTL_MS` default of five minutes,
 * so the wallet stops on its own terms with copy it wrote, rather than waiting for the
 * handshake to expire and having to explain a terminal `expired` status it could have
 * predicted.
 */
export const POLL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * PKCE (RFC 7636). S256 only — `plain` protects nothing across a redirect, and the
 * bridge refuses anything else anyway.
 *
 * 64 bytes of entropy: the spec allows a 43-128 character verifier, base64url of 64
 * bytes lands at 86, and there is no reason to sit at the floor for a value that
 * exists to make a leaked code useless.
 */
export const PKCE_METHOD = 'S256';
export const PKCE_VERIFIER_BYTES = 64;

/**
 * The `authorize` budget, echoed so the wallet can say something true before it is
 * refused. The server enforces this; nothing here does.
 *
 * It is the cap on wallet generation — each handshake can cause at most one Stellar
 * account, funded out of the operator's XLM — which is why it is the tightest budget
 * on the login path and why a retry loop here spends someone else's money.
 */
export const AUTHORIZE_BUDGET = { limit: 20, windowMs: 10 * 60 * 1000 } as const;

/**
 * Refresh the access token this long before it expires.
 *
 * A minute covers a slow round trip on mobile data plus the clock skew between a phone
 * and Pollar — the same reason `txGuard` carries CLOCK_SKEW_S. Refreshing exactly at
 * expiry means a device running a few seconds fast presents a token Pollar has already
 * retired, and the user meets a logout they did not ask for.
 */
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/**
 * Pollar's SDK API paths, relative to the `api_base_url` the redemption handed back.
 *
 * Only the three the wallet uses are here. Balances and history are deliberately NOT
 * among them: a Pollar `internal` wallet is an ordinary Stellar account, so Horizon
 * answers both — through the code the wallet already has, for every asset rather than
 * only the ones the Pollar app enabled, and without spending a token to read a public
 * ledger.
 */
export const POLLAR_TX_SIGN_PATH = '/tx/sign';
export const POLLAR_TX_SUBMIT_PATH = '/tx/submit';
export const POLLAR_TX_STATUS_PATH = '/tx/status';

/** Pollar authenticates with its own header, not `Authorization`. */
export const POLLAR_API_KEY_HEADER = 'x-pollar-api-key';

/**
 * Pollar result codes the wallet branches on. Its envelope always carries a `code`,
 * and that code — not the message — is the stable part of its contract.
 */
export const POLLAR_CODE_SIGNED = 'SDK_TX_SIGNED';
export const POLLAR_CODE_SUBMIT = 'SDK_TX_SUBMIT';
