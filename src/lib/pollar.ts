/**
 * The Pollar OAuth bridge, from the wallet's side.
 *
 * Pollar turns a Google/GitHub login into a Stellar account whose key it custodies in
 * its own KMS — the user never sees a seed phrase. Its hosted login is built for a
 * browser SDK, so it hands the user to a redirect URI that must be a host registered
 * with Pollar, which a `cosmospay://` deep link or a loopback port can never be. The
 * community server owns that half and exposes the two steps a wallet can actually
 * perform: open an authorization, redeem a code.
 *
 * ## The wallet uses the POLL flow, not the redirect flow
 *
 * The bridge supports both, and the poll flow is the right one here for a reason that
 * is not merely convenience: this bundle runs as an MV3 popup, a side panel, a Tauri
 * desktop window, a Tauri mobile app and a web page, and only some of those can be
 * addressed by URL at all. The redirect flow would need a registered `redirect_uri`
 * per shell, allow-listed per consumer server-side; the poll flow needs nothing, and
 * the code never touches the browser — the landing page says "you can close this
 * window" and the wallet reads the code back over an authenticated channel.
 *
 * It also survives the MV3 popup closing. Opening the consent screen dismisses the
 * popup, taking every bit of React state with it, so the handshake cannot live in
 * memory: `state` is persisted by `lib/pollarSession.ts` and the poll resumes on the
 * next open. A redirect flow would have had nowhere to land in the meantime.
 *
 * ## What this module will not do
 *
 * It never touches a Stellar key, because there is none to touch: the whole point of a
 * Pollar wallet is that the key lives in Pollar's KMS. Signing goes through
 * `lib/pollarApi.ts`, and every envelope still passes `assertSafeToSign` first — see
 * the header there.
 */
import { parseShape, type Check } from '@/lib/apiShape';
import { apiError, ApiRequestError } from '@/lib/apiError';
import { RETRY_AFTER_CAP_S } from '@/constants/api';
import { gatewayApi } from '@/lib/endpoints';
import { tNow } from '@/lib/i18n';
import { newPkce, type Pkce } from '@/lib/pkce';
import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  type PollarProvider,
} from '@/constants/pollar';
import {
  PollarActivationShape,
  PollarAuthorizationShape,
  PollarLogoutShape,
  PollarSessionShape,
  PollarSessionStatusShape,
  PollarTokenPairShape,
  PollarTrustlineShape,
} from '@/lib/pollarShapes';

/* --------------------------------- types -------------------------------- */

/** A wallet Pollar resolved for the user. `internal` is the KMS-custodied one. */
export interface PollarWallet {
  type: string;
  address: string | null;
  chain?: string;
  exists_on_stellar?: boolean;
  funding_mode?: string;
  network?: string;
}

/** What `authorize` hands back: where to send the user, and the handle to poll on. */
export interface PollarAuthorization {
  state: string;
  authorization_url: string;
  provider: string;
  redirect_uri: string | null;
}

export type PollarStatus = 'pending' | 'authorized' | 'exchanging' | 'consumed' | 'failed' | 'expired';

export interface PollarSessionStatus {
  status: PollarStatus;
  state: string;
  code?: string;
  error_code?: string | null;
}

/** A live Pollar session: the tokens, the wallet, and how to reach Pollar directly. */
export interface PollarSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Epoch milliseconds, as Pollar reports it. */
  expires_at: number;
  user_id: string | null;
  wallet: PollarWallet;
  wallets: PollarWallet[];
  profile: { email?: string; first_name?: string; last_name?: string; avatar?: string };
  publishable_key: string;
  api_base_url: string;
}

export interface PollarTokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
}

/* ------------------------------- transport ------------------------------- */

const base = () => `${gatewayApi()}/v1/pollar`;
const auth = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

/**
 * One bridge request.
 *
 * A separate transport from `cosmospay.ts` rather than an export of it, because the
 * bridge is the one surface where a `429` is an ordinary outcome rather than an
 * incident: `authorize` is capped at twenty per ten minutes precisely because each one
 * can cause a funded Stellar account to exist. `apiError` gives the caller a typed
 * `RateLimitedError` carrying the server's own `Retry-After`, so the login screen can
 * say when instead of inviting a retry that will also be refused.
 */
async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  apiKey: string,
  shape: Check<unknown>,
  body?: unknown,
): Promise<T> {
  const url = `${base()}${path}`;
  const res = await fetch(url, {
    method,
    headers: { ...auth(apiKey), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) throw apiError(url, res, json, RETRY_AFTER_CAP_S);
  parseShape(url, shape, json);
  return json as T;
}

/* ------------------------------- the flow -------------------------------- */

/** A handshake in progress: everything needed to finish it after a popup close. */
export interface PollarHandshake {
  state: string;
  provider: PollarProvider;
  /** Kept out of the browser: this is what makes a leaked code useless. */
  verifier: string;
  /** Epoch ms. Poll past this and the bridge would refuse anyway. */
  startedAt: number;
}

/**
 * Open a login. Returns the URL to send the user to plus the handshake to keep.
 *
 * The URL is validated as https here rather than trusted, even though the bridge built
 * it: it is about to be handed to the OS opener, and that is the boundary where a
 * scheme becomes a launched program. `openExternal` refuses anything but https for the
 * same reason, so this check is what turns a silent no-op into an error the user can
 * read.
 */
export async function pollarAuthorize(
  apiKey: string,
  provider: PollarProvider,
  deviceLabel?: string,
): Promise<{ authorization: PollarAuthorization; handshake: PollarHandshake; pkce: Pkce }> {
  const pkce = await newPkce();
  const authorization = await call<PollarAuthorization>('POST', '/oauth/authorize', apiKey, PollarAuthorizationShape, {
    provider,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
    ...(deviceLabel ? { device_label: deviceLabel } : {}),
  });

  if (!isHttps(authorization.authorization_url)) {
    throw new ApiRequestError(`${base()}/oauth/authorize`, 502, 'bad_authorization_url', tNow('pollar.badUrl'));
  }

  return {
    authorization,
    handshake: { state: authorization.state, provider, verifier: pkce.verifier, startedAt: Date.now() },
    pkce,
  };
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Poll a handshake once. `authorized` is the only status that carries a code. */
export function pollarStatus(apiKey: string, state: string): Promise<PollarSessionStatus> {
  return call<PollarSessionStatus>('GET', `/oauth/sessions/${encodeURIComponent(state)}`, apiKey, PollarSessionStatusShape);
}

/**
 * Redeem a code for a live session.
 *
 * A `409` here is not a failure: a first login legitimately returns one while Pollar
 * creates the Stellar account, funds its reserve and adds the trustlines, and the
 * server documents retrying the same code. That retry is the caller's, not this
 * function's — `waitForCode` owns the loop, and burying a second one here would make
 * the two budgets interact in a way neither could reason about.
 */
export function pollarExchange(apiKey: string, code: string, verifier: string): Promise<PollarSession> {
  return call<PollarSession>('POST', '/oauth/token', apiKey, PollarSessionShape, {
    code,
    code_verifier: verifier,
  });
}

export function pollarRefresh(apiKey: string, refreshToken: string): Promise<PollarTokenPair> {
  return call<PollarTokenPair>('POST', '/oauth/refresh', apiKey, PollarTokenPairShape, { refresh_token: refreshToken });
}

export function pollarLogout(apiKey: string, accessToken: string, everywhere = false): Promise<{ revoked: number }> {
  return call<{ revoked: number }>('POST', '/oauth/logout', apiKey, PollarLogoutShape, {
    access_token: accessToken,
    everywhere,
  });
}

/** Fund a deferred wallet's XLM reserve. Idempotent: a repeat reports `activated: false`. */
export function pollarActivate(apiKey: string, publicKey: string): Promise<{ public_key: string; amount: string; activated: boolean }> {
  return call('POST', '/wallets/activate', apiKey, PollarActivationShape, { public_key: publicKey });
}

/** Enable the app's configured assets on a funded wallet. */
export function pollarDefaultTrustlines(apiKey: string, address: string): Promise<{ code: string }> {
  return call('POST', `/wallets/${encodeURIComponent(address)}/trustlines/default`, apiKey, PollarTrustlineShape);
}

/* -------------------------------- polling -------------------------------- */

/** Why a wait ended without a code. Terminal — the caller starts a new handshake. */
export class PollarHandshakeError extends Error {
  readonly status: PollarStatus | 'timeout';
  /** Pollar's own code when it sent one, e.g. `EXPIRED_CLIENT_ID`. Never copy. */
  readonly providerCode: string | null;

  constructor(status: PollarStatus | 'timeout', providerCode: string | null, message: string) {
    super(message);
    this.name = 'PollarHandshakeError';
    this.status = status;
    this.providerCode = providerCode;
  }
}

/**
 * Poll until the user comes back, then return the code.
 *
 * Three things this does deliberately:
 *
 *  - **`shouldStop` is checked before every poll, not only between sleeps.** The user
 *    can navigate away or lock the wallet while a login is open, and a loop that only
 *    notices at its own cadence keeps an authenticated request going for up to
 *    {@link POLL_TIMEOUT_MS} after the screen that wanted it is gone.
 *  - **A 429 pauses rather than aborts.** The poll route's budget is shared with the
 *    public callback, so a busy gateway can refuse a poll that had nothing wrong with
 *    it. The server says how long to wait and this honours it; giving up would throw
 *    away a login the user has already consented to.
 *  - **Every non-`pending` status is terminal.** `authorized` returns the code;
 *    everything else — `failed`, `expired`, and also `consumed`/`exchanging`, which
 *    mean another caller got there first — stops the loop. A status the contract does
 *    not know throws out of `parseShape` rather than reading as "keep waiting".
 */
export async function waitForCode(
  apiKey: string,
  handshake: PollarHandshake,
  shouldStop: () => boolean,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string> {
  const deadline = handshake.startedAt + POLL_TIMEOUT_MS;

  for (;;) {
    if (shouldStop()) throw new PollarHandshakeError('timeout', null, tNow('pollar.cancelled'));
    if (Date.now() > deadline) throw new PollarHandshakeError('timeout', null, tNow('pollar.timedOut'));

    let status: PollarSessionStatus;
    try {
      status = await pollarStatus(apiKey, handshake.state);
    } catch (e) {
      const wait = e instanceof ApiRequestError && e.status === 429 ? retryDelay(e) : null;
      if (wait === null) throw e;
      await sleep(wait);
      continue;
    }

    if (status.status === 'authorized' && status.code) return status.code;
    if (status.status !== 'pending') {
      throw new PollarHandshakeError(status.status, status.error_code ?? null, tNow(`pollar.status.${status.status}`));
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/** The server's own answer to "when", clamped to at least one poll interval. */
function retryDelay(e: ApiRequestError): number {
  const after = 'retryAfterMs' in e ? (e as { retryAfterMs: number | null }).retryAfterMs : null;
  return Math.max(after ?? POLL_INTERVAL_MS, POLL_INTERVAL_MS);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
