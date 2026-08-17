/**
 * React binding for the keyed cache in `lib/query.ts`.
 *
 * Kept separate so the cache itself stays framework-free and unit-testable, and so
 * the same entries are readable from non-React contexts (the approval window, a
 * Capacitor resume handler, the service worker's mirror).
 *
 * `useSyncExternalStore` is native to React 19 — no state library needed for this.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { peek, subscribe } from '@/lib/query';

/**
 * Subscribe to one cache key. Re-renders only when THAT key changes, which is the
 * point: the store hook returns a fresh 130-key object on every state change, so a
 * component reading balances used to re-render when a toast appeared.
 */
export function useQueryValue<T>(key: string): T | undefined {
  const sub = useCallback((fn: () => void) => subscribe(key, fn), [key]);
  // getSnapshot must return a stable reference for unchanged data, and `peek`
  // returns a fresh wrapper each call — so read the field, not the wrapper.
  const get = useCallback(() => peek<T>(key).data, [key]);
  return useSyncExternalStore(sub, get, get);
}

/** Same, with the error and the last-updated stamp for a "stale" indicator. */
export function useQueryState<T>(key: string): { data?: T; error?: unknown; ts: number } {
  const sub = useCallback((fn: () => void) => subscribe(key, fn), [key]);
  const getData = useCallback(() => peek<T>(key).data, [key]);
  const getError = useCallback(() => peek<T>(key).error, [key]);
  const getTs = useCallback(() => peek<T>(key).ts, [key]);
  const data = useSyncExternalStore(sub, getData, getData);
  const error = useSyncExternalStore(sub, getError, getError);
  const ts = useSyncExternalStore(sub, getTs, getTs);
  return { data, error, ts };
}
