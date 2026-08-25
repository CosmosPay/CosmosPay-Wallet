/**
 * A tiny keyed read cache: deduplication, TTL, stale-while-revalidate, generation
 * counters for cancellation, and retry limited to idempotent reads.
 *
 * What it replaces. Every read in this wallet is scoped to `network × account`, and
 * nothing in the code said so. The consequences were concrete:
 *
 *  - **A stale-write race.** `switchNetwork` set the new id and cleared the balance;
 *    an in-flight `getAccountState` for the OLD network then resolved and wrote its
 *    result in unconditionally. Horizon requests go through axios and cannot be
 *    aborted, so an AbortController would not have caught this — the fix is a
 *    generation counter per key: a result whose generation is stale is dropped.
 *  - **No deduplication.** `key={screen}` remounts the tree on every navigation, so
 *    Home → History fired `getHistory` twice within a second, and opening the popup
 *    fired `refresh` twice (mount effect + visibilitychange).
 *  - **Nothing survived a popup close**, so every open repainted `0.00` before the
 *    network answered. Persisted entries hydrate from storage and revalidate behind
 *    the already-correct number.
 *
 * Deliberately not react-query: that is ~13 kB and would still need this key space
 * written by hand. This is ~150 lines with no dependency, in a wallet whose build
 * already fails on unexpected transitive packages.
 */
import { storageGet, storageSet } from '@/lib/storage';

interface Entry<T> {
  data?: T;
  error?: unknown;
  /** epoch ms of the last successful write; 0 when never fetched. */
  ts: number;
  /** In-flight request, so concurrent callers share one network round trip. */
  promise?: Promise<T>;
  /** Bumped by invalidate(); a resolution carrying an older value is discarded. */
  gen: number;
}

const cache = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
/** Keys whose latest value is mirrored into platform storage. */
const persisted = new Set<string>();

const PERSIST_PREFIX = 'cosmos.q.';

function entry<T>(key: string): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { ts: 0, gen: 0 };
    cache.set(key, e as Entry<unknown>);
  }
  return e;
}

function emit(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn();
}

export function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(key);
  };
}

/** Current snapshot for `key`. Never triggers a fetch. */
export function peek<T>(key: string): { data?: T; error?: unknown; ts: number } {
  const e = cache.get(key) as Entry<T> | undefined;
  return e ? { data: e.data, error: e.error, ts: e.ts } : { ts: 0 };
}

export function isFresh(key: string, ttl: number, now = Date.now()): boolean {
  const e = cache.get(key);
  return !!e && e.ts > 0 && now - e.ts < ttl;
}

/**
 * Drop every entry whose key starts with `prefix` and bump its generation, so any
 * in-flight request for it is ignored when it lands.
 */
export function invalidate(prefix: string): void {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix)) continue;
    e.gen += 1;
    e.data = undefined;
    e.error = undefined;
    e.ts = 0;
    e.promise = undefined;
    emit(key);
  }
}

/** Mark entries stale without discarding them — the UI keeps showing the last value. */
export function expire(prefix: string): void {
  for (const [key, e] of cache) {
    if (key.startsWith(prefix)) {
      e.ts = 0;
      emit(key);
    }
  }
}

export interface QueryOptions<T> {
  key: string;
  fetcher: () => Promise<T>;
  /** How long a value stays fresh. A fresh value short-circuits `run`. */
  ttl?: number;
  /**
   * Retry on failure. ONLY for idempotent reads — never for a swap, payout or any
   * other request that moves money, where a retry is a duplicate transaction.
   */
  retry?: number;
  /** Mirror the value into platform storage so a reopened popup paints it instantly. */
  persist?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attempt<T>(fetcher: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetcher();
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      // 250ms · 2ⁿ with jitter. Deterministic base so the backoff is testable.
      await sleep(250 * 2 ** i + (i * 37) % 100);
    }
  }
  throw lastErr;
}

/**
 * Read `key`, fetching if needed. Concurrent callers share one request; a fresh
 * value is returned without touching the network unless `force` is set.
 */
export function run<T>(opts: QueryOptions<T>, force = false): Promise<T> {
  const { key, fetcher, ttl = 0, retry = 0, persist = false } = opts;
  const e = entry<T>(key);
  if (persist) persisted.add(key);

  if (!force && e.ts > 0 && Date.now() - e.ts < ttl && e.data !== undefined) {
    return Promise.resolve(e.data);
  }
  if (e.promise) return e.promise;

  const gen = e.gen;
  const p = attempt(fetcher, retry)
    .then((data) => {
      // Dropped on purpose: this key was invalidated (network or account changed)
      // while the request was in flight, so its answer describes a world that is no
      // longer on screen.
      if (e.gen !== gen) return data;
      e.data = data;
      e.error = undefined;
      e.ts = Date.now();
      e.promise = undefined;
      // Explicitly fire-and-forget: this is a cache, and storageSet throws now.
      if (persisted.has(key)) void storageSet(PERSIST_PREFIX + key, JSON.stringify({ data, ts: e.ts })).catch(() => {});
      emit(key);
      return data;
    })
    .catch((err) => {
      if (e.gen === gen) {
        e.error = err;
        e.promise = undefined;
        emit(key);
      }
      throw err;
    });

  e.promise = p;
  return p;
}

/**
 * Load a persisted snapshot into the cache. Marked stale (`ts: 0`) on purpose: the
 * UI paints it immediately, and the next `run` revalidates it.
 */
export async function hydrate<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await storageGet(PERSIST_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { data: T };
    const e = entry<T>(key);
    if (e.data === undefined) {
      e.data = parsed.data;
      e.ts = 0;
      emit(key);
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

/** Test seam: forget everything. */
export function resetCache(): void {
  cache.clear();
  listeners.clear();
  persisted.clear();
}
