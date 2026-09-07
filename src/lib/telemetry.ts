/**
 * What this wallet reports about itself: errors, timings, and the transactions it
 * built.
 *
 * ## Why it exists
 *
 * `console.error` was the whole trail (the error boundary said so, in a comment).
 * That is not a trail: an extension popup's console dies with the popup, a phone's
 * WebView console is unreachable without a cable, and the failures that matter most
 * — a signature that hung, a Horizon submit that came back `op_no_trust`, a screen
 * that crashed on a lazy import — are exactly the ones nobody is watching a console
 * for. None of them produce a request to the gateway either, so the server-side
 * access log cannot see them: they happen entirely on the device.
 *
 * ## Two transports, decided by whether the wallet has an account
 *
 * A wallet that has a Cosmos Pay API key posts straight to the gateway with it, and
 * those events are attributed to the account that owns the wallet — that is what
 * puts them in the user's own dashboard. A wallet with no account has no credential
 * at all, so it posts to the developer platform's public telemetry route, which
 * forwards it under one shared consumer: ANONYMOUS, rather than attributed to a
 * guess. The keyed path falling back on 401/403 is not a nicety — every key minted
 * before `activity:write` existed will refuse, and a silently dead error stream is
 * worse than an anonymous one.
 *
 * ## What is never sent
 *
 * No seed, no password, no vault key, no session — none of those are reachable from
 * here, and that is by construction rather than by discipline: this module is in
 * `lib/`, which the layering keeps out of `state/`.
 *
 * What IS reachable and still must not travel anonymously is the account's own data:
 * its address, its amounts, a transaction hash. On the keyed path those go to the
 * user's own dashboard and are theirs to read; on the anonymous path they would tie
 * an install to a Stellar account nobody asked to publish, so {@link ACCOUNT_PROPS}
 * are stripped there. Memo text is never sent on either path — a memo is a message
 * to a third party, and often an exchange's deposit reference.
 *
 * ## It is OFF until the user says otherwise
 *
 * Opt-IN, not opt-out, and that is not this module's call to make: onboarding already
 * asks for it (`setup.metricsOptIn`, unchecked by default) and STORE_LISTING.md
 * discloses usage metrics as "optional, off by default" to the Chrome Web Store. A
 * default of on would make both of those statements false, in a wallet whose users
 * read them precisely because it is non-custodial.
 *
 * So `finishOnboarding` writes the answer to that checkbox here, `settings.diagnostics`
 * flips it afterwards, and every entry point below reads {@link OPT_OUT_KEY} first.
 * Turning it off drops what is already queued rather than keeping it for later — an
 * opt-out that still sends the last few minutes is not one.
 */
import { APP_VERSION } from '@/constants/app';
import {
  DEVICE_KEY,
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  MAX_EVENT_AGE_MS,
  MAX_QUEUED,
  OPT_OUT_KEY,
  QUEUE_KEY,
} from '@/constants/telemetry';
import { devPlatformUrl, gatewayApi } from '@/lib/endpoints';
import { buildKind } from '@/lib/platform';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error';

/** What a call site passes. `type` is a name from `constants/telemetry`'s EVENT. */
export interface TelemetryReport {
  level?: TelemetryLevel;
  category?: string;
  message?: string;
  durationMs?: number;
  network?: string;
  props?: Record<string, unknown>;
}

/** One queued event, as it will be sent. */
interface QueuedEvent extends TelemetryReport {
  type: string;
  eventId: string;
  occurredAt: string;
  sessionId: string;
  distinctId: string;
  appVersion: string;
  platform: string;
}

/**
 * Props that identify the ACCOUNT rather than the app, stripped from anonymous
 * reports.
 *
 * Not a blocklist of "sensitive words" — it is the list of fields this wallet
 * actually attaches that would let a shared, unauthenticated feed be joined back to
 * one Stellar account. A new prop that names an account or a transaction belongs
 * here on the same day it is added.
 */
const ACCOUNT_PROPS = [
  'account',
  'address',
  'destination',
  'source',
  'txHash',
  // Every field that carries a QUANTITY, not just the one called `amount`. The swap
  // event reports what came back as `received` and the pool withdrawal reports
  // `shares`; stripping `amount` while those went through would have been the rule
  // written down and not applied.
  'amount',
  'received',
  'shares',
];

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let flushing = false;
/** Set once the keyed path has been refused; the anonymous one is used from then on. */
let keyRefused = false;

/* Set by the store as the wallet learns them. Kept here rather than passed at every
   call site because a crash handler has no access to the store — the whole point of
   this module is that it works when the app does not. */
let apiKey: string | null = null;
let env: 'dev' | 'prod' = 'dev';
let network: string | null = null;

let sessionId = '';
let distinctId = '';

/* ------------------------------ configuration ------------------------------ */

/**
 * Point the reporter at the current account and network.
 *
 * `apiKey` null means the anonymous path, which is the correct state for a wallet
 * with no Cosmos Pay account and also the correct state after `lock()` — a locked
 * wallet has no business attributing anything.
 */
export function configureTelemetry(cfg: { apiKey?: string | null; env?: 'dev' | 'prod'; network?: string | null }): void {
  if (cfg.apiKey !== undefined) {
    // A different key is a different account: whatever it refused is not this one's
    // problem, so the fallback latch is released.
    if (cfg.apiKey !== apiKey) keyRefused = false;
    apiKey = cfg.apiKey;
  }
  if (cfg.env) env = cfg.env;
  if (cfg.network !== undefined) network = cfg.network;
}

/**
 * Diagnostics are off until the user turns them on.
 *
 * The absent value means OFF, which is also what a browser that refuses storage
 * yields: reporting when the preference cannot be read would be reporting against a
 * choice we cannot see.
 */
export function telemetryEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Turn reporting on or off. Turning it off drops what is queued, immediately. */
export function setTelemetryEnabled(on: boolean): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore — the getter's fallback is off */
  }
  if (!on) {
    queue = [];
    void storageRemove(QUEUE_KEY).catch(() => {});
  }
}

/* --------------------------------- ids ------------------------------------- */

/** Random, opaque, and never derived from a key or an address. */
function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * One id per app run, one per install.
 *
 * The install id is persisted so a crash on launch can be told apart from the same
 * crash on ten different devices; the run id is not, so it resets with the process.
 * Neither identifies a person, and neither is sent instead of authentication — the
 * keyed path is authenticated by the key.
 */
async function loadDistinctId(): Promise<string> {
  const stored = await storageGet(DEVICE_KEY).catch(() => null);
  if (stored) return stored;
  const fresh = randomId();
  await storageSet(DEVICE_KEY, fresh).catch(() => {});
  return fresh;
}

/* ------------------------------- reporting --------------------------------- */

/**
 * Queue one event. Never throws, never awaits, never blocks a flow.
 *
 * Safe to call from a `catch` in the signing path, from an error boundary, and from
 * a global error handler — which is why every failure inside it is swallowed rather
 * than surfaced.
 */
export function report(type: string, opts: TelemetryReport = {}): void {
  try {
    if (!telemetryEnabled()) return;
    queue.push({
      ...opts,
      type,
      eventId: randomId(),
      occurredAt: new Date().toISOString(),
      sessionId: sessionId || (sessionId = randomId()),
      distinctId,
      appVersion: APP_VERSION,
      platform: buildKind(),
      network: opts.network ?? network ?? undefined,
    });
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);

    // An error goes now. It is the event most likely to be followed by the app
    // disappearing — a crashed popup, a killed tab — and the one worth a request.
    if (opts.level === 'error' || queue.length >= MAX_BATCH) {
      void flushTelemetry();
      return;
    }
    ensureTimer();
  } catch {
    /* telemetry must never break what it is measuring */
  }
}

/**
 * Report a caught error.
 *
 * The MESSAGE travels, the stack does not: a stack from a minified bundle names
 * chunk offsets rather than functions, and it is the one field most likely to carry
 * an interpolated value nobody meant to send. `code` is the gateway's machine-
 * readable error code where there is one (see `lib/apiError.ts`), which is what a
 * dashboard can group by — the message is written for a human and gets reworded.
 */
export function reportError(type: string, err: unknown, props: Record<string, unknown> = {}): void {
  const e = err as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  report(type, {
    level: 'error',
    category: 'error',
    message: typeof e?.message === 'string' ? e.message : String(err ?? 'unknown error'),
    props: {
      ...props,
      ...(typeof e?.name === 'string' ? { name: e.name } : {}),
      ...(typeof e?.code === 'string' ? { code: e.code } : {}),
      ...(typeof e?.status === 'number' ? { status: e.status } : {}),
    },
  });
}

/* -------------------------------- transport -------------------------------- */

/** Strip account-identifying props from a batch bound for the anonymous route. */
function anonymize(events: QueuedEvent[]): QueuedEvent[] {
  return events.map((e) => {
    if (!e.props) return e;
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.props)) {
      if (!ACCOUNT_PROPS.includes(k)) props[k] = v;
    }
    return { ...e, props };
  });
}

/** Events too old for the gateway to keep their own timestamp are not worth sending. */
function fresh(events: QueuedEvent[]): QueuedEvent[] {
  const cutoff = Date.now() - MAX_EVENT_AGE_MS;
  return events.filter((e) => Date.parse(e.occurredAt) >= cutoff);
}

/**
 * Send what is queued.
 *
 * On failure the batch goes BACK to the front of the queue and is persisted, because
 * the common failure here is not a broken server — it is a popup that closed, a
 * phone that lost signal, a laptop that slept. That is the opposite of the choice the
 * dashboard makes with its own buffer, and for the opposite reason: this client is
 * offline routinely and its events are bounded by {@link MAX_QUEUED} and their age.
 */
export async function flushTelemetry(): Promise<void> {
  if (flushing || !queue.length || !telemetryEnabled()) return;
  flushing = true;
  const batch = fresh(queue.splice(0, MAX_BATCH));
  if (!batch.length) {
    flushing = false;
    return;
  }

  try {
    const key = apiKey;
    if (key && !keyRefused) {
      const res = await postEvents(`${gatewayApi()}/v1/activity/events`, { events: batch }, {
        Authorization: `Bearer ${key}`,
      });
      // 401/403 = this key predates the `activity:write` scope (or lost it). Every
      // later batch takes the anonymous route instead of retrying into the same
      // refusal; a rotation reconfigures the key and clears the latch.
      if (res === 401 || res === 403) {
        keyRefused = true;
        throw new Error('activity scope refused');
      }
      if (!delivered(res)) throw new Error(`ingest failed (${res})`);
    } else {
      const res = await postEvents(`${devPlatformUrl()}/api/telemetry`, { events: anonymize(batch), env }, {});
      if (!delivered(res)) throw new Error(`telemetry failed (${res})`);
    }
    // Landed. Anything still queued goes on the next tick rather than recursing.
    if (!queue.length) await storageRemove(QUEUE_KEY).catch(() => {});
    else await persistQueue();
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUED);
    await persistQueue();
  } finally {
    flushing = false;
  }
}

/**
 * Only a 2xx counts as delivered.
 *
 * Written as "not 2xx" rather than "4xx or 5xx" because the status that matters most
 * here is the one that is NEITHER: `postEvents` reports a transport failure as 0, and
 * an offline wallet is the single most common way a flush fails. A `>= 400` test reads
 * as if it covers everything and quietly drops every event a plane, a lift or a closed
 * popup produced.
 */
function delivered(status: number): boolean {
  return status >= 200 && status < 300;
}

/** POST a batch and return the status. Network failures surface as 0. */
async function postEvents(url: string, body: unknown, headers: Record<string, string>): Promise<number> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      // Lets the request outlive the page when this fires on the way out.
      keepalive: true,
    });
    return res.status;
  } catch {
    return 0;
  }
}

/* -------------------------------- lifecycle -------------------------------- */

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushTelemetry(), FLUSH_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}

async function persistQueue(): Promise<void> {
  try {
    if (!queue.length) return;
    await storageSet(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
  } catch {
    // The queue is a best-effort cache, not the vault: a storage failure here is
    // explicitly not worth surfacing (see the storageSet docblock — the callers that
    // are genuinely fire-and-forget say so at their own call site, and this is one).
  }
}

async function hydrateQueue(): Promise<void> {
  try {
    const raw = await storageGet(QUEUE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as QueuedEvent[];
    if (Array.isArray(stored)) queue = fresh([...stored, ...queue]).slice(-MAX_QUEUED);
  } catch {
    // Unreadable queue: drop it rather than let one bad write disable reporting
    // for the life of the install.
    await storageRemove(QUEUE_KEY).catch(() => {});
  }
}

/**
 * Wire the automatic captures and pick up anything a previous run could not send.
 *
 * Idempotent, and safe to call before the wallet is unlocked: nothing here reads a
 * session, and a crash during onboarding is exactly the one worth having.
 */
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  void (async () => {
    distinctId = await loadDistinctId().catch(() => randomId());
    if (telemetryEnabled()) {
      await hydrateQueue();
      ensureTimer();
      void flushTelemetry();
    }
  })();

  window.addEventListener('error', (e) => {
    report('app.error', {
      level: 'error',
      category: 'error',
      message: e.message,
      // Where, not what: enough to find the line in a sourcemap, with none of the
      // surrounding code or values.
      props: { source: e.filename, line: e.lineno, column: e.colno },
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    reportError('app.unhandledRejection', e.reason);
  });

  // `pagehide` rather than `unload`: the extension popup and every WebView here get
  // it, and `unload` disables the back/forward cache where it exists at all.
  window.addEventListener('pagehide', () => {
    void persistQueue();
    void flushTelemetry();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void persistQueue();
      void flushTelemetry();
    }
  });
}
