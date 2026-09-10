/** Tunables for the activity/diagnostics reporter. Data only — the behaviour is in
 *  `src/lib/telemetry.ts`, and every event name it can send is in `EVENT` below. */

/**
 * How long an event may sit in the buffer before it is sent.
 *
 * Not a sampling interval: the queue also flushes when it fills, when the app goes
 * to the background, and after anything reported at `error`. This is the ceiling on
 * how stale a quiet stream gets, and it is deliberately long — the MV3 popup dies
 * the moment it closes, so a shorter timer would not save more events, it would only
 * spend more requests while somebody reads their balance.
 */
export const FLUSH_INTERVAL_MS = 15_000;

/** Events per request. Matches the gateway's ingest cap — a larger batch is refused whole. */
export const MAX_BATCH = 100;

/**
 * Events held while offline.
 *
 * A wallet is offline more often than a web page: an extension popup opened on a
 * plane, a phone in a lift, a desktop app whose gateway is down. Past this the OLDEST
 * events are dropped, because the ones worth having when the connection returns are
 * the ones nearest to whatever went wrong.
 */
export const MAX_QUEUED = 300;

/** Storage keys. The queue survives a popup close; the two ids identify nobody. */
export const QUEUE_KEY = 'cosmos.telemetry.queue';
export const DEVICE_KEY = 'cosmos.telemetry.device';
/**
 * The consent flag: `'on'`, or absent for off.
 *
 * In localStorage rather than the platform store because it is read SYNCHRONOUSLY,
 * before the first report, by code that cannot await — the same reason the theme and
 * the language stay there (see the KEEP_IN_LOCAL_STORAGE list in `lib/storage.ts`).
 * It is a device preference and not a secret; the wallet's own copy of the answer
 * lives in the sealed profile as `metricsOptIn`.
 */
export const OPT_OUT_KEY = 'cosmos.telemetry';

/**
 * Age past which a queued event is dropped instead of sent.
 *
 * The gateway clamps anything older than seven days to its own receipt time, which
 * would file a week-old crash as if it happened now. Dropping it is the honest
 * outcome: an event whose timestamp cannot be preserved is worse than absent,
 * because it lands in the middle of an unrelated incident.
 */
export const MAX_EVENT_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/* ------------------------- request tracing ------------------------- */

/**
 * Header carrying a per-request trace id to the gateway and the dev platform.
 *
 * The point is joining two halves of one failure. A wallet reports `api.error` with a
 * status and a route; the gateway has its own access-log line for the same call. Without
 * a shared id the only way to pair them is a timestamp and a guess, which stops working
 * the moment two users hit the same route in the same second.
 *
 * It must survive the gateway to be worth anything: APISIX's `proxy-rewrite` on the
 * Cosmos route strips `Authorization`, `apikey` and the `X-Cosmos-*` internal markers,
 * and this is deliberately none of those.
 *
 * It names no account. A fresh random value per request cannot be correlated across
 * calls, let alone back to a person, which is what lets it travel on the anonymous
 * route unstripped — unlike {@link ACCOUNT_PROPS}, which cannot.
 */
export const TRACE_HEADER = 'X-Cosmos-Trace-Id';

/** Where the same id is recorded on the event, so the two feeds join on one key. */
export const TRACE_PROP = 'traceId';

/* --------------------- diagnostics ownership attestation --------------------- */

/**
 * Domain tag for the diagnostics attestation. NEVER {@link SIGN_MESSAGE_DOMAIN}'s.
 *
 * Sharing a tag with the dapp-facing `signMessage` would mean a website could ask a user
 * to sign a plain "message" that is really a well-formed attestation, and receive
 * something this pipeline accepts as proof that the user's wallet vouched for a report.
 * Two protocols, two tags — see `lib/signMessage.ts`.
 */
export const ATTESTATION_DOMAIN = 'Cosmos Wallet diagnostics attestation v1';

/** Attestation version, carried in the signed body so a verifier can refuse an old shape. */
export const ATTESTATION_VERSION = 1;

/**
 * How long a signed attestation stays attachable before it is rebuilt.
 *
 * Bounded for the reason every signature in this wallet is bounded: an unbounded one is a
 * standing credential, and this one is produced with no prompt at all. Twelve hours is
 * long enough that an ordinary user signs one per day, and short enough that a copy lifted
 * off a device stops verifying while its owner still has the wallet.
 */
export const ATTESTATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * The single prop the attestation travels in.
 *
 * One key rather than four, because every one of them is account-identifying and
 * {@link ACCOUNT_PROPS} strips by exact key name — four keys is four chances to add the
 * fifth and forget. `tests/unit/telemetry.test.ts` asserts it is stripped anonymously.
 */
export const ATTESTATION_PROP = 'ownership';

/**
 * Byte budget an event's `props` must stay under for the attestation to be added.
 *
 * The gateway caps serialized `props` at 8192 bytes and REPLACES an oversized object with
 * a marker rather than rejecting the event — so appending an attestation to an event
 * already near the cap would silently destroy the event's own props AND the attestation.
 * The headroom is what makes attaching it safe; a batch whose every event is too big
 * simply carries no proof, which is the honest outcome.
 */
export const ATTESTATION_PROPS_BUDGET = 7_168;

/**
 * Every event name the wallet reports, in one table.
 *
 * A table rather than string literals at the call sites, for the same reason the
 * screen list is one: the dashboard filters and groups on these, so a typo does not
 * fail anywhere — it silently creates a second event type that nobody is looking at.
 *
 * LOWERCASE, dot-separated, with `_` inside a word. That is not a style preference: the
 * gateway validates `type` against `^[a-z0-9][a-z0-9._:-]*$` and refuses the WHOLE batch
 * that carries a name it does not match, so one camelCase entry here would silently take
 * every event queued beside it. `tests/unit/telemetry.test.ts` checks the table against
 * that pattern, because nothing else would until a batch was already being dropped.
 */
export const EVENT = {
  // lifecycle
  appOpen: 'app.open',
  appError: 'app.error',
  renderFailed: 'app.render_failed',
  unhandledRejection: 'app.unhandled_rejection',
  // navigation
  screenView: 'screen.view',
  // auth / session
  unlockOk: 'session.unlock',
  unlockFailed: 'session.unlock_failed',
  lock: 'session.lock',
  walletCreated: 'wallet.created',
  walletImported: 'wallet.imported',
  socialLogin: 'auth.social_login',
  socialLoginFailed: 'auth.social_login_failed',
  // money
  paymentSent: 'payment.sent',
  paymentFailed: 'payment.failed',
  swapSubmitted: 'swap.submitted',
  swapFailed: 'swap.failed',
  trustlineAdded: 'trustline.added',
  trustlineFailed: 'trustline.failed',
  liquidityDeposit: 'liquidity.deposit',
  liquidityWithdraw: 'liquidity.withdraw',
  liquidityFailed: 'liquidity.failed',
  payLinkCreated: 'paylink.created',
  payLinkFailed: 'paylink.failed',
  // gateway
  apiError: 'api.error',
  apiSlow: 'api.slow',
} as const;

/**
 * A gateway call slower than this is reported as `api.slow`.
 *
 * Chosen against what the user experiences rather than what a server considers slow:
 * past a couple of seconds a screen that is waiting looks broken, and that is the
 * complaint ("it hangs") that these events have to be able to explain.
 */
export const SLOW_REQUEST_MS = 2_500;
