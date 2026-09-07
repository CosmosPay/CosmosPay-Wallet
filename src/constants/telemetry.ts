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
