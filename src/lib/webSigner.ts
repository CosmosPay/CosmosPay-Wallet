/**
 * The web build's dapp transport: how a signing request reaches the approval window
 * when there is no extension in the picture.
 *
 * The extension has a background service worker, a content script that stamps the
 * origin, and an internal request id the page never sees (see extension-src/sw.js).
 * Hosted as a page, the wallet has none of that — so the dapp opens the approval
 * window itself (`approve/?web=1&n=<nonce>&o=<origin>`), the window announces itself to
 * `window.opener`, and the dapp posts the request straight back. One window, one
 * request, one reply.
 *
 * WHAT MAKES THE ORIGIN TRUSTWORTHY. Not the `o` parameter — a page writes its own
 * URLs, so that value is only ever used as a postMessage TARGET, which is precisely the
 * safe direction: aiming `ready` at an origin the opener does not have means the opener
 * never receives it, and nothing leaks. The origin the window SHOWS, grants and replies
 * to is `MessageEvent.origin`, which the browser stamps and a page cannot forge. Both
 * must agree, and the message must come from `window.opener` itself, or it is not a
 * request from the site the user just left.
 *
 * WHAT IS NOT DEFENDED HERE, deliberately: nothing in this module decides whether an
 * envelope is safe to sign. It transports bytes. The envelope is decoded against the
 * WALLET's network config and rendered operation by operation by the approval window,
 * exactly as it is for the extension — see `src/lib/txGuard.ts`.
 *
 * A COOP HEADER BREAKS THIS. `Cross-Origin-Opener-Policy: same-origin` on either side
 * severs `window.opener`, as does a dapp opening the window with `noopener`. There is no
 * recovery path: the window has nobody to answer, so it says the request was not found
 * rather than pretending. Do not add that header to whatever serves `approve/`.
 */
import {
  DAPP_METHODS,
  MAX_MESSAGE_CHARS,
  MAX_REQUEST_ID_CHARS,
  MAX_URI_CHARS,
  MAX_XDR_CHARS,
  WEB_READY_RETRY_MS,
  WEB_REQUEST_WAIT_MS,
  WEB_SIGNER_PARAM,
  WEB_SIGNER_PROTOCOL,
  WEB_SIGNER_TARGET,
  type DappMethod,
} from '@/constants/dapp';

/** What the approval window's own URL says about the handshake it is part of. */
export interface WebSignerContext {
  /** Echoed in `ready` and required on the request, so a stale window cannot answer. */
  nonce: string;
  /** The origin `ready` is aimed at. A target, never an identity — see the header. */
  origin: string;
}

/** A request as the window will act on it. `origin` is the browser's, not the URL's. */
export interface WebSignerRequest {
  /** The dapp's own correlation id. Echoed back verbatim; never routed on. */
  id: string;
  /** `MessageEvent.origin` — stamped by the browser. */
  origin: string;
  method: DappMethod;
  params: { xdr?: string; message?: string; uri?: string; networkPassphrase?: string };
}

/** Network facts every reply carries, so the provider never has to ask separately. */
export interface WebSignerNetwork {
  network: string;
  networkPassphrase: string;
  networkUrl: string;
}

/** One incoming message, reduced to the three things a decision may depend on. */
export interface IncomingMessage {
  data: unknown;
  /** `MessageEvent.origin`. */
  origin: string;
  /** `MessageEvent.source === window.opener`. */
  fromOpener: boolean;
}

/**
 * An origin the wallet will talk to: a real scheme and host, and nothing else.
 *
 * `'null'` — what the browser stamps on a sandboxed iframe, a `data:` document or a
 * `file://` page — is refused rather than displayed. It names no site, so a user cannot
 * judge it, and a grant recorded against it would be a grant to everything else that
 * shares the same nothing.
 */
function isHttpOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value === 'null') return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value;
  } catch {
    return false;
  }
}

/** A handshake nonce: opaque, short, and from an alphabet a URL carries unchanged. */
function isNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/**
 * Read the handshake out of the window's own URL, or null when this window is not part
 * of one — which is every extension request and every human who typed the address.
 */
export function webSignerContext(href: string): WebSignerContext | null {
  let params: URLSearchParams;
  try {
    params = new URL(href).searchParams;
  } catch {
    return null;
  }
  if (params.get(WEB_SIGNER_PARAM.flag) !== '1') return null;
  const nonce = params.get(WEB_SIGNER_PARAM.nonce);
  const origin = params.get(WEB_SIGNER_PARAM.origin);
  if (!isNonce(nonce) || !isHttpOrigin(origin)) return null;
  return { nonce, origin };
}

/** "I am open and waiting for your request." Carries no wallet state at all. */
export function readyMessage(ctx: WebSignerContext): Record<string, unknown> {
  return { target: WEB_SIGNER_TARGET, type: 'ready', protocol: WEB_SIGNER_PROTOCOL, nonce: ctx.nonce };
}

/** A string field within its cap. Empty is not a value: every one of these is required. */
function field(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

/**
 * The parameters `method` requires, or null when they are missing or oversized.
 *
 * Per method rather than one permissive object: `signTransaction` with no `xdr` used to
 * be perfectly representable, and what that produces downstream is an approval window
 * offering to sign the empty string.
 */
function paramsFor(method: DappMethod, raw: unknown): WebSignerRequest['params'] | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'getAddress':
      return {};
    case 'signTransaction': {
      const xdr = field(p.xdr, MAX_XDR_CHARS);
      if (!xdr) return null;
      // Optional, and NOT the passphrase anything is signed with: the window compares it
      // against the wallet's own and refuses a mismatch. See ApprovePopup.
      const asked = p.networkPassphrase;
      if (asked != null && !field(asked, 256)) return null;
      return { xdr, ...(typeof asked === 'string' ? { networkPassphrase: asked } : {}) };
    }
    case 'signMessage': {
      const message = field(p.message, MAX_MESSAGE_CHARS);
      return message ? { message } : null;
    }
    case 'requestPayment': {
      const uri = field(p.uri, MAX_URI_CHARS);
      // Only the scheme is checked here; `src/lib/sep7.ts` decides it is a payment.
      return uri && /^web\+stellar:/i.test(uri) ? { uri } : null;
    }
  }
}

/**
 * Decide whether an incoming message is the request this window was opened for.
 *
 * Every branch returns null — a rejection here is silence, not an error posted back:
 * the sender is by definition not the peer this window is talking to, so answering it
 * would be the leak the checks exist to prevent. The real dapp times out instead.
 */
export function readWebRequest(msg: IncomingMessage, ctx: WebSignerContext): WebSignerRequest | null {
  if (!msg.fromOpener) return null;
  if (!isHttpOrigin(msg.origin) || msg.origin !== ctx.origin) return null;

  const d = msg.data;
  if (!d || typeof d !== 'object') return null;
  const m = d as Record<string, unknown>;
  if (m.target !== WEB_SIGNER_TARGET || m.type !== 'request') return null;
  if (m.protocol !== WEB_SIGNER_PROTOCOL) return null;
  if (m.nonce !== ctx.nonce) return null;

  const id = field(m.id, MAX_REQUEST_ID_CHARS);
  if (!id) return null;
  const method = DAPP_METHODS.find((k) => k === m.method);
  if (!method) return null;
  const params = paramsFor(method, m.params);
  if (!params) return null;

  return { id, origin: msg.origin, method, params };
}

/** The reply envelope. `ok: false` carries `error`; `ok: true` carries `result`. */
export function resultMessage(
  req: WebSignerRequest,
  ok: boolean,
  result?: unknown,
  error?: string,
): Record<string, unknown> {
  return { target: WEB_SIGNER_TARGET, type: 'result', protocol: WEB_SIGNER_PROTOCOL, id: req.id, ok, result, error };
}

/* ------------------------------ browser wiring ----------------------------- */

/**
 * Announce the window and wait for the one request it exists to serve.
 *
 * `ready` is re-sent on an interval rather than once: the dapp opens this window and
 * attaches its listener in the same task, but a popup served from cache can be ready
 * first, and a handshake that depends on winning that race fails as "the wallet never
 * opened". Resolves null on timeout, which the window renders as a request it could not
 * find — the honest answer when no dapp ever spoke.
 */
export function awaitWebRequest(
  ctx: WebSignerContext,
  timeoutMs = WEB_REQUEST_WAIT_MS,
): Promise<WebSignerRequest | null> {
  return new Promise((resolve) => {
    const opener = window.opener as Window | null;
    if (!opener) {
      resolve(null);
      return;
    }
    let done = false;
    const stop = (req: WebSignerRequest | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(ping);
      clearTimeout(timer);
      resolve(req);
    };
    const onMessage = (ev: MessageEvent) => {
      const req = readWebRequest({ data: ev.data, origin: ev.origin, fromOpener: ev.source === opener }, ctx);
      if (req) stop(req);
    };
    const announce = () => {
      try {
        opener.postMessage(readyMessage(ctx), ctx.origin);
      } catch {
        /* the dapp window is gone; the timeout below ends this */
      }
    };
    window.addEventListener('message', onMessage);
    const ping = setInterval(announce, WEB_READY_RETRY_MS);
    const timer = setTimeout(() => stop(null), timeoutMs);
    announce();
  });
}

/**
 * Answer the dapp, on the origin the browser stamped on its request and no other.
 *
 * Returns whether the message went out. It cannot report whether it ARRIVED — a closed
 * or navigated dapp window swallows it — which is why the provider keeps its own
 * timeout and watches for this window closing.
 */
export function replyWebRequest(req: WebSignerRequest, ok: boolean, result?: unknown, error?: string): boolean {
  const opener = window.opener as Window | null;
  if (!opener) return false;
  try {
    opener.postMessage(resultMessage(req, ok, result, error), req.origin);
    return true;
  } catch {
    return false;
  }
}
