/**
 * Typed failures from the CosmosPay gateway.
 *
 * The transport used to end every non-2xx with `throw new Error(msg)`, where `msg`
 * was whatever the server put in `.message`. That is a string, so the only way for a
 * caller to tell "you are throttled, wait and retry" from "that receiver does not
 * exist" was to compare the rendered copy — which CLAUDE.md bans, and for a concrete
 * reason: the approval window already shipped a bug where retryable-vs-terminal was
 * decided by matching `'Contraseña incorrecta.'`, one translation away from inverting.
 *
 * So the status and the server's own machine code travel on the error object, and the
 * copy stays purely for the user. `code` is the gateway's `ApiErrorCode` enum
 * (`rate_limited`, `insufficient_scope`, `provider_unavailable`, …) — English, stable,
 * and API surface rather than copy. Branch on `code` or on the subclass, never on
 * `.message`.
 */
import { tNow } from '@/lib/i18n';

/** A non-2xx from the gateway, with the machine-readable parts kept. */
export class ApiRequestError extends Error {
  readonly status: number;
  /** The gateway's own error code, when it sent one. Never a translated string. */
  readonly code: string | null;
  readonly url: string;

  constructor(url: string, status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.url = url;
    this.status = status;
    this.code = code;
  }
}

/**
 * `429`, which the gateway now reports as `code: "rate_limited"`.
 *
 * It used to fall back to `provider_unavailable` — "an upstream is in trouble" — for a
 * request the service had refused itself. The distinction matters here because the
 * Pollar login flow is budgeted tightly enough to hit it in normal use: twenty
 * `authorize` calls per ten minutes is the cap on wallet generation, and a user who
 * fumbles a consent screen a few times is inside that budget but not far inside it.
 *
 * `retryAfterMs` is the server's own answer to "when", so nothing here invents a
 * backoff curve: `Retry-After` is authoritative and `RateLimit-Reset` is the fallback.
 * When neither arrives the field is null and the caller must not retry automatically —
 * guessing an interval against a fixed-window limiter is how a client turns one
 * refusal into a stream of them.
 */
export class RateLimitedError extends ApiRequestError {
  /** Milliseconds to wait, per the server. Null when it did not say. */
  readonly retryAfterMs: number | null;
  /** The budget and what is left of it, when the RateLimit-* triple was sent. */
  readonly limit: number | null;
  readonly remaining: number | null;

  constructor(
    url: string,
    code: string | null,
    message: string,
    info: { retryAfterMs: number | null; limit: number | null; remaining: number | null },
  ) {
    super(url, 429, code, message);
    this.name = 'RateLimitedError';
    this.retryAfterMs = info.retryAfterMs;
    this.limit = info.limit;
    this.remaining = info.remaining;
  }
}

/** A finite non-negative integer from a header, or null. Never NaN, never Infinity. */
function headerInt(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * How long to wait, in ms, from whatever the response was willing to say.
 *
 * `Retry-After` is delta-seconds here (the gateway sends the numeric form), and
 * `RateLimit-Reset` is delta-seconds too — NOT an epoch. Both are read as durations
 * and neither is trusted past `cap`: a server bug or a hostile proxy sending
 * `Retry-After: 86400` would otherwise park a retry a day out, and a wallet that
 * silently stops talking to the gateway for a day is worse than one that retries early
 * and is refused again.
 */
function retryAfterMs(res: Response, cap: number): number | null {
  const seconds = headerInt(res, 'retry-after') ?? headerInt(res, 'ratelimit-reset');
  if (seconds === null) return null;
  return Math.min(seconds, cap) * 1000;
}

/**
 * Build the error for a failed response. `body` is the already-decoded JSON, or null
 * when there was none — this never reads the stream, because the caller has.
 *
 * The message prefers the server's `.message`: it is the only part that knows *which*
 * receiver was missing. A 429 is the exception — its server copy is written for an
 * integrator reading logs, so the user gets a translated line and the raw code stays
 * on `.code` for the code to branch on.
 */
export function apiError(url: string, res: Response, body: unknown, retryCapSeconds: number): ApiRequestError {
  const env = (body ?? {}) as { message?: unknown; error?: unknown; code?: unknown };
  const code = typeof env.code === 'string' ? env.code : null;
  const serverMsg = typeof env.message === 'string' ? env.message : typeof env.error === 'string' ? env.error : '';

  if (res.status === 429) {
    const wait = retryAfterMs(res, retryCapSeconds);
    const message =
      wait === null
        ? tNow('api.rateLimited')
        : tNow('api.rateLimitedRetry', { seconds: Math.ceil(wait / 1000) });
    return new RateLimitedError(url, code, message, {
      retryAfterMs: wait,
      limit: headerInt(res, 'ratelimit-limit'),
      remaining: headerInt(res, 'ratelimit-remaining'),
    });
  }

  return new ApiRequestError(url, res.status, code, serverMsg || tNow('api.requestFailed', { status: res.status }));
}
