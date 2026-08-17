import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dataCache, { buildScopedKey } from '../lib/cache.ts';

export interface UseScopedDataOptions {
  /** Time to live in milliseconds for this cache entry */
  ttl?: number;
  /** Whether automatic fetching is enabled. Default: true */
  enabled?: boolean;
}

export interface UseScopedDataResult<T> {
  /** Cached data or undefined if pending/expired/missing */
  data: T | undefined;
  /** Error encountered during the fetch, or null */
  error: Error | null;
  /** True when enabled, data is missing/fetching, and no error has occurred */
  isLoading: boolean;
}

/**
 * Custom React hook for fetching and subscribing to network × account scoped data.
 *
 * - Scopes cache keys strictly to `<network>:<account>:<key>`.
 * - Leverages `useSyncExternalStore` with key-level subscriptions so the component
 *   only re-renders when this specific key or its matching scope is updated.
 * - Automatically fetches data on mount / prop change, and automatically refetches
 *   when prefix invalidation (e.g. after a mutation) clears the cached data.
 * - Fully deduplicates in-flight requests and avoids stale writes across network switches.
 */
export function useScopedData<T>(
  network: string,
  account: string,
  key: string,
  fetcher: () => Promise<T>,
  options?: UseScopedDataOptions
): UseScopedDataResult<T> {
  const isEnabled = options?.enabled !== false;
  const hasValidScope = Boolean(
    network && network.trim() && account && account.trim() && key && key.trim()
  );

  const scopedKey = hasValidScope
    ? buildScopedKey({ network, account }, key)
    : null;

  // Keep a stable ref to fetcher to avoid restarting effects on inline lambda changes
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [error, setError] = useState<Error | null>(null);

  // Subscribe specifically to changes affecting this key or its prefixes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!scopedKey) {
        return () => {};
      }
      return dataCache.subscribeKey(scopedKey, onStoreChange);
    },
    [scopedKey]
  );

  // Snapshot getter returning the current cached value for this scoped key
  const getSnapshot = useCallback(() => {
    if (!scopedKey) return undefined;
    return dataCache.get<T>(scopedKey);
  }, [scopedKey]);

  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Effect to automatically fetch data when missing/invalidated
  useEffect(() => {
    if (!isEnabled || !scopedKey || data !== undefined) {
      return;
    }

    let isCancelled = false;
    setError(null);

    dataCache
      .fetch<T>(scopedKey, () => fetcherRef.current(), { ttl: options?.ttl })
      .then(() => {
        if (!isCancelled) {
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [scopedKey, isEnabled, data, options?.ttl]);

  // Loading state is true when enabled, a valid key exists, data is not yet loaded, and no error
  const isLoading =
    isEnabled && Boolean(scopedKey) && data === undefined && error === null;

  return {
    data,
    error,
    isLoading,
  };
}

export default useScopedData;
