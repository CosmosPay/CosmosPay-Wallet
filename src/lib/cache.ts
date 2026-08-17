/**
 * Framework-free data caching utility for Cosmos Pay.
 *
 * Designed to prevent race conditions, deduplicate in-flight requests,
 * enforce strict network × account scoping, manage TTLs, and discard stale writes
 * via a hierarchical generation counter.
 */

export interface CacheScope {
  network: string;
  account: string;
}

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  timestamp: number;
  ttl: number;
  expiresAt: number;
  generation: number;
}

export interface CacheOptions {
  /** Default Time-To-Live in milliseconds. Default: 30,000 (30 seconds). */
  defaultTtlMs?: number;
  /** Clock provider returning timestamps in milliseconds. Default: Date.now */
  now?: () => number;
}

export interface FetchOptions<T = unknown> {
  /** Override default TTL for this request in milliseconds. Set to Infinity or <= 0 for non-expiring. */
  ttl?: number;
  /** Force fresh fetch even if valid cached data is available. */
  force?: boolean;
  /** Optional filter to decide whether a successful result should be cached. */
  shouldCache?: (data: T) => boolean;
}

export type CacheListener = () => void;

export type CacheChangeType =
  | 'set'
  | 'delete'
  | 'invalidate'
  | 'clear'
  | 'scope_change';

export interface CacheChangeEvent {
  type: CacheChangeType;
  key?: string;
  prefix?: string;
  scope?: CacheScope;
  generation: number;
}

export type CacheChangeListener = (event: CacheChangeEvent) => void;

export const CACHE_KEY_DELIMITER = ':';

/**
 * Constructs a scoped cache key in format: `<network>:<account>:<resourceKey>`
 */
export function buildScopedKey(scope: CacheScope, resourceKey: string): string {
  const network = scope.network.trim();
  const account = scope.account.trim();
  const res = resourceKey.trim();

  if (!network) {
    throw new Error('CacheScope.network must not be empty');
  }
  if (!account) {
    throw new Error('CacheScope.account must not be empty');
  }
  if (!res) {
    throw new Error('resourceKey must not be empty');
  }

  return `${network}${CACHE_KEY_DELIMITER}${account}${CACHE_KEY_DELIMITER}${res}`;
}

/**
 * Constructs a key prefix for scoping and prefix-based invalidation.
 * - `buildPrefix('testnet')` -> `'testnet:'`
 * - `buildPrefix('testnet', 'GABC...')` -> `'testnet:GABC...:'`
 */
export function buildPrefix(network: string, account?: string): string {
  const net = network.trim();
  if (!net) {
    throw new Error('network must not be empty');
  }
  if (!account || !account.trim()) {
    return `${net}${CACHE_KEY_DELIMITER}`;
  }
  return `${net}${CACHE_KEY_DELIMITER}${account.trim()}${CACHE_KEY_DELIMITER}`;
}

/**
 * Parses a scoped cache key back into its constituent parts.
 * Returns null if the key does not match the `<network>:<account>:<resourceKey>` pattern.
 */
export function parseScopedKey(
  key: string
): { network: string; account: string; resourceKey: string } | null {
  const parts = key.split(CACHE_KEY_DELIMITER);
  if (parts.length < 3) return null;

  const network = parts[0];
  const account = parts[1];
  const resourceKey = parts.slice(2).join(CACHE_KEY_DELIMITER);

  if (!network || !account || !resourceKey) return null;
  return { network, account, resourceKey };
}

/**
 * Interface for scoped cache operations bound to a specific network × account scope.
 */
export interface IScopedCache {
  readonly scope: Readonly<CacheScope>;
  get<T>(resourceKey: string): T | undefined;
  getEntry<T>(resourceKey: string): CacheEntry<T> | undefined;
  set<T>(resourceKey: string, data: T, ttlMs?: number): void;
  has(resourceKey: string): boolean;
  delete(resourceKey: string): boolean;
  fetch<T>(
    resourceKey: string,
    fetcher: () => Promise<T>,
    options?: FetchOptions<T>
  ): Promise<T>;
  invalidate(resourceKey?: string): number | boolean;
  invalidateAll(): number;
  subscribe(listener: CacheListener): () => void;
  subscribeKey(resourceKey: string, listener: CacheListener): () => void;
  buildKey(resourceKey: string): string;
}

/**
 * Concrete scoped cache view over the root DataCache.
 */
export class ScopedCache implements IScopedCache {
  public readonly scope: Readonly<CacheScope>;
  private readonly rootCache: DataCache;

  constructor(
    rootCache: DataCache,
    scope: CacheScope
  ) {
    this.rootCache = rootCache;
    this.scope = Object.freeze({ ...scope });
  }

  public buildKey(resourceKey: string): string {
    return buildScopedKey(this.scope, resourceKey);
  }

  public get<T>(resourceKey: string): T | undefined {
    return this.rootCache.get<T>(this.buildKey(resourceKey));
  }

  public getEntry<T>(resourceKey: string): CacheEntry<T> | undefined {
    return this.rootCache.getEntry<T>(this.buildKey(resourceKey));
  }

  public set<T>(resourceKey: string, data: T, ttlMs?: number): void {
    this.rootCache.set<T>(this.buildKey(resourceKey), data, ttlMs);
  }

  public has(resourceKey: string): boolean {
    return this.rootCache.has(this.buildKey(resourceKey));
  }

  public delete(resourceKey: string): boolean {
    return this.rootCache.delete(this.buildKey(resourceKey));
  }

  public fetch<T>(
    resourceKey: string,
    fetcher: () => Promise<T>,
    options?: FetchOptions<T>
  ): Promise<T> {
    return this.rootCache.fetch<T>(this.buildKey(resourceKey), fetcher, options);
  }

  public invalidate(resourceKey?: string): number | boolean {
    if (resourceKey) {
      return this.rootCache.invalidate(this.buildKey(resourceKey));
    }
    return this.invalidateAll();
  }

  public invalidateAll(): number {
    const prefix = buildPrefix(this.scope.network, this.scope.account);
    return this.rootCache.invalidatePrefix(prefix);
  }

  public subscribe(listener: CacheListener): () => void {
    return this.rootCache.subscribe(listener);
  }

  public subscribeKey(resourceKey: string, listener: CacheListener): () => void {
    return this.rootCache.subscribeKey(this.buildKey(resourceKey), listener);
  }
}

/**
 * Pure TypeScript, framework-free cache with in-flight deduplication,
 * TTL management, scoped keys, prefix invalidation, and generation counter
 * protection against stale writes and race conditions.
 */
export class DataCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<CacheListener>();
  private readonly detailedListeners = new Set<CacheChangeListener>();

  private globalGeneration = 0;
  private readonly prefixGenerations = new Map<string, number>();
  private readonly keyGenerations = new Map<string, number>();

  private snapshotVersion = 0;
  private currentScope: CacheScope | null = null;

  public readonly defaultTtlMs: number;
  public readonly now: () => number;

  constructor(options?: CacheOptions) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 30_000;
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Returns the number of entries currently stored (including expired ones not yet purged).
   */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * Returns the number of currently active in-flight requests.
   */
  public get inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Snapshot version integer, incremented on every cache mutation.
   * Suitable for React 18+ useSyncExternalStore getSnapshot.
   */
  public getSnapshot(): number {
    return this.snapshotVersion;
  }

  /**
   * Current active scope if set.
   */
  public getScope(): CacheScope | null {
    return this.currentScope ? { ...this.currentScope } : null;
  }

  /**
   * Sets the active scope. If the network or account changes,
   * the generation for the previous scope is bumped, preventing any
   * mid-flight fetches started in the old scope from writing stale data.
   */
  public setScope(scope: CacheScope | null): void {
    const prev = this.currentScope;
    this.currentScope = scope ? { ...scope } : null;

    if (
      prev &&
      (!scope || prev.network !== scope.network || prev.account !== scope.account)
    ) {
      const prevPrefix = buildPrefix(prev.network, prev.account);
      this.bumpGeneration(prevPrefix);
    }

    this.snapshotVersion++;
    this.notifyListeners({
      type: 'scope_change',
      scope: this.currentScope ?? undefined,
      generation: this.globalGeneration,
    });
  }

  /**
   * Computes the current effective generation counter for a specific key.
   * Checks key-level generation, matching prefix generations, and global generation.
   */
  public getGeneration(key: string): number {
    let maxGen = this.keyGenerations.get(key) ?? 0;
    for (const [prefix, gen] of this.prefixGenerations) {
      if (prefix === '' || key.startsWith(prefix)) {
        if (gen > maxGen) {
          maxGen = gen;
        }
      }
    }
    return maxGen;
  }

  /**
   * Returns the global generation counter.
   */
  public getGlobalGeneration(): number {
    return this.globalGeneration;
  }

  /**
   * Increments the generation counter globally and for the specified key or prefix.
   */
  public bumpGeneration(keyOrPrefix?: string): number {
    this.globalGeneration++;
    if (keyOrPrefix !== undefined) {
      this.prefixGenerations.set(keyOrPrefix, this.globalGeneration);
      this.keyGenerations.set(keyOrPrefix, this.globalGeneration);
    }
    return this.globalGeneration;
  }

  /**
   * Returns true if the entry is expired according to current time.
   */
  public isExpired(entry: CacheEntry<unknown>): boolean {
    if (entry.expiresAt === Infinity) return false;
    return this.now() >= entry.expiresAt;
  }

  /**
   * Checks if a non-expired entry exists for the given key.
   */
  public has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      this.snapshotVersion++;
      this.notifyListeners({
        type: 'delete',
        key,
        generation: this.getGeneration(key),
      });
      return false;
    }
    return true;
  }

  /**
   * Retrieves the cached value for key, or undefined if missing or expired.
   */
  public get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      this.snapshotVersion++;
      this.notifyListeners({
        type: 'delete',
        key,
        generation: this.getGeneration(key),
      });
      return undefined;
    }

    return entry.data as T;
  }

  /**
   * Retrieves full CacheEntry metadata for key, or undefined if missing or expired.
   */
  public getEntry<T>(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      this.snapshotVersion++;
      this.notifyListeners({
        type: 'delete',
        key,
        generation: this.getGeneration(key),
      });
      return undefined;
    }

    return entry as CacheEntry<T>;
  }

  /**
   * Sets a value in the cache with the given or default TTL.
   */
  public set<T>(key: string, data: T, ttlMs?: number): void {
    const now = this.now();
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl > 0 && Number.isFinite(ttl) ? now + ttl : Infinity;
    const generation = this.getGeneration(key);

    const entry: CacheEntry<T> = {
      key,
      data,
      timestamp: now,
      ttl,
      expiresAt,
      generation,
    };

    this.entries.set(key, entry as CacheEntry<unknown>);
    this.snapshotVersion++;
    this.notifyListeners({
      type: 'set',
      key,
      generation,
    });
  }

  /**
   * Deletes a key from cache without bumping the generation.
   */
  public delete(key: string): boolean {
    const had = this.entries.delete(key);
    if (had) {
      this.snapshotVersion++;
      this.notifyListeners({
        type: 'delete',
        key,
        generation: this.getGeneration(key),
      });
    }
    return had;
  }

  /**
   * Invalidates a specific key: removes it from cache, bumps its generation counter,
   * and notifies subscribers. Any in-flight fetch for this key that started prior
   * to invalidation will discard its result upon completion.
   */
  public invalidate(key: string): boolean {
    const had = this.entries.delete(key);
    const newGen = this.bumpGeneration(key);
    this.snapshotVersion++;
    this.notifyListeners({
      type: 'invalidate',
      key,
      generation: newGen,
    });
    return had;
  }

  /**
   * Invalidates all keys starting with the given prefix.
   * Bumps the prefix generation counter so any in-flight requests matching the prefix
   * will discard their results upon completion.
   *
   * @param prefix String prefix to match (e.g. 'testnet:' or 'testnet:GABC...:')
   * @returns Number of cached entries deleted
   */
  public invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        count++;
      }
    }
    const newGen = this.bumpGeneration(prefix);
    this.snapshotVersion++;
    this.notifyListeners({
      type: 'invalidate',
      prefix,
      generation: newGen,
    });
    return count;
  }

  /**
   * Invalidates all cached entries and in-flight operations for a given network.
   */
  public invalidateNetwork(network: string): number {
    return this.invalidatePrefix(buildPrefix(network));
  }

  /**
   * Invalidates all cached entries and in-flight operations for an account on a network.
   */
  public invalidateAccount(network: string, account: string): number {
    return this.invalidatePrefix(buildPrefix(network, account));
  }

  /**
   * Invalidates all entries belonging to the specified scope.
   */
  public invalidateScope(scope: CacheScope): number {
    return this.invalidatePrefix(buildPrefix(scope.network, scope.account));
  }

  /**
   * Completely clears the cache store, purges in-flight tracking, bumps the global generation,
   * and notifies subscribers.
   */
  public clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    const newGen = this.bumpGeneration('');
    this.snapshotVersion++;
    this.notifyListeners({
      type: 'clear',
      generation: newGen,
    });
  }

  /**
   * Purges all expired entries from cache.
   * @returns Count of purged entries
   */
  public purgeExpired(): number {
    let count = 0;
    const now = this.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt !== Infinity && now >= entry.expiresAt) {
        this.entries.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.snapshotVersion++;
      this.notifyListeners({
        type: 'delete',
        generation: this.globalGeneration,
      });
    }
    return count;
  }

  /**
   * Fetches data with in-flight deduplication, TTL caching, and generation-based
   * race condition / stale-write protection.
   *
   * 1. If non-expired cached data exists and !options.force, returns cached data immediately.
   * 2. If a request for `key` is already in flight, returns the same existing Promise.
   * 3. Captures generation at initiation. Upon resolution, if the generation changed
   *    (due to network/account switch or key/prefix invalidation), safely discards
   *    the result without writing to cache.
   */
  public async fetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: FetchOptions<T>
  ): Promise<T> {
    // 1. Check if cached and fresh
    if (!options?.force) {
      const cached = this.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    }

    // 2. Check if a request for this key is already in flight
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // 3. Capture generation token prior to initiating asynchronous work
    const startGeneration = this.getGeneration(key);

    // 4. Wrap fetcher in managed Promise
    const promise = (async (): Promise<T> => {
      try {
        const data = await fetcher();

        // 5. Verify generation before writing to cache
        const currentGeneration = this.getGeneration(key);
        const isStale = currentGeneration !== startGeneration;

        if (!isStale) {
          const shouldCache = options?.shouldCache
            ? options.shouldCache(data)
            : true;

          if (shouldCache) {
            this.set<T>(key, data, options?.ttl);
          }
        }
        // If isStale, result is safely discarded and NOT written to the cache store.

        return data;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Returns a ScopedCache view bound to the given scope.
   */
  public scoped(scope: CacheScope): IScopedCache {
    return new ScopedCache(this, scope);
  }

  /**
   * Scoped convenience fetch.
   */
  public fetchScoped<T>(
    scope: CacheScope,
    resourceKey: string,
    fetcher: () => Promise<T>,
    options?: FetchOptions<T>
  ): Promise<T> {
    return this.fetch<T>(buildScopedKey(scope, resourceKey), fetcher, options);
  }

  /**
   * Scoped convenience get.
   */
  public getScoped<T>(scope: CacheScope, resourceKey: string): T | undefined {
    return this.get<T>(buildScopedKey(scope, resourceKey));
  }

  /**
   * Scoped convenience set.
   */
  public setScoped<T>(
    scope: CacheScope,
    resourceKey: string,
    data: T,
    ttlMs?: number
  ): void {
    this.set<T>(buildScopedKey(scope, resourceKey), data, ttlMs);
  }

  /**
   * Scoped convenience has.
   */
  public hasScoped(scope: CacheScope, resourceKey: string): boolean {
    return this.has(buildScopedKey(scope, resourceKey));
  }

  /**
   * Scoped convenience delete.
   */
  public deleteScoped(scope: CacheScope, resourceKey: string): boolean {
    return this.delete(buildScopedKey(scope, resourceKey));
  }

  /**
   * Scoped convenience invalidation.
   */
  public invalidateScoped(
    scope: CacheScope,
    resourceKey?: string
  ): number | boolean {
    if (resourceKey) {
      return this.invalidate(buildScopedKey(scope, resourceKey));
    }
    return this.invalidateScope(scope);
  }

  /**
   * Subscribes a listener to cache updates (compatible with useSyncExternalStore).
   * @returns Unsubscribe function
   */
  public subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribes a listener specifically for updates affecting a particular key.
   * Notifies when the exact key is modified, when a matching prefix is invalidated,
   * when the cache is cleared, or when scope changes.
   * @returns Unsubscribe function
   */
  public subscribeKey(key: string, listener: CacheListener): () => void {
    return this.subscribeDetailed((event) => {
      if (
        event.type === 'clear' ||
        event.type === 'scope_change' ||
        (event.key !== undefined && event.key === key) ||
        (event.prefix !== undefined && key.startsWith(event.prefix))
      ) {
        listener();
      }
    });
  }

  /**
   * Subscribes a listener specifically for updates matching a prefix.
   * @returns Unsubscribe function
   */
  public subscribePrefix(prefix: string, listener: CacheListener): () => void {
    return this.subscribeDetailed((event) => {
      if (
        event.type === 'clear' ||
        event.type === 'scope_change' ||
        (event.prefix !== undefined && (prefix.startsWith(event.prefix) || event.prefix.startsWith(prefix))) ||
        (event.key !== undefined && event.key.startsWith(prefix))
      ) {
        listener();
      }
    });
  }

  /**
   * Subscribes a detailed listener that receives CacheChangeEvents.
   * @returns Unsubscribe function
   */
  public subscribeDetailed(listener: CacheChangeListener): () => void {
    this.detailedListeners.add(listener);
    return () => {
      this.detailedListeners.delete(listener);
    };
  }

  /**
   * Returns a copy of all currently active cache keys.
   */
  public keys(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Internal helper to safely dispatch notifications to all subscribers.
   */
  private notifyListeners(event: CacheChangeEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        // Prevent faulty subscriber from breaking cache operations
        console.error('DataCache listener threw error:', err);
      }
    }

    for (const listener of Array.from(this.detailedListeners)) {
      try {
        listener(event);
      } catch (err) {
        console.error('DataCache detailed listener threw error:', err);
      }
    }
  }
}

/**
 * Creates a new DataCache instance with the given configuration options.
 */
export function createCache(options?: CacheOptions): DataCache {
  return new DataCache(options);
}

/**
 * Global default cache instance for application-wide use.
 */
export const dataCache = new DataCache();
export default dataCache;
