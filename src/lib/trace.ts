/**
 * A per-request trace id, carried to the backends and recorded on the event.
 *
 * One failure has two halves and they live in different places. The wallet knows it got a
 * 502 on `POST /v1/swaps` and can say what the screen was doing; the gateway knows which
 * upstream refused and why. Pairing them by timestamp works until two people hit the same
 * route in the same second, which on the routes that matter is most seconds.
 *
 * So every outbound call mints one of these, sends it as {@link TRACE_HEADER} and files it
 * on whatever the reporter says about that call. It is not authentication and not an
 * identity: a fresh random value per request correlates one request's two halves and
 * nothing else — no session, no install, no account. That is precisely what lets it ride
 * the anonymous telemetry route unstripped, where an address or an amount may not.
 *
 * Not the event's `eventId` reused: an event is what the wallet decided to say, a trace is
 * one HTTP call. A single call can produce two events (`api.slow` and then `api.error`),
 * and a retry is a new call that must not claim to be the same one.
 */

/**
 * A fresh trace id.
 *
 * `crypto.randomUUID` where it exists, and a time-plus-random fallback where it does not —
 * the same shape `lib/telemetry.ts` uses for its own ids, and for the same reason: this is
 * called from paths that must not throw, including ones running inside a `catch`. An
 * insecure-context WebView or an old Android System WebView is a real deployment target
 * here, and a trace id that threw would take the request with it.
 */
export function newTraceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
