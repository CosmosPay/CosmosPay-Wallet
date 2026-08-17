import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  DataCache,
  ScopedCache,
  createCache,
  buildScopedKey,
  buildPrefix,
  parseScopedKey,
  type CacheScope,
} from './cache.ts';

describe('DataCache utility', () => {
  let cache: DataCache;
  let currentTime = 1_000_000;

  beforeEach(() => {
    currentTime = 1_000_000;
    cache = new DataCache({
      defaultTtlMs: 5_000,
      now: () => currentTime,
    });
  });

  describe('Key Scoping & Helpers', () => {
    it('builds strictly scoped keys using <network>:<account>:<resourceKey>', () => {
      const scope: CacheScope = {
        network: 'testnet',
        account: 'GD5JJSFIBJ7O52766M5Y724X6K2W4W5Q',
      };
      const key = buildScopedKey(scope, 'balances');
      assert.equal(
        key,
        'testnet:GD5JJSFIBJ7O52766M5Y724X6K2W4W5Q:balances'
      );
    });

    it('throws error when building scoped key with empty components', () => {
      assert.throws(
        () => buildScopedKey({ network: '', account: 'GD5J' }, 'balances'),
        /CacheScope\.network must not be empty/
      );
      assert.throws(
        () => buildScopedKey({ network: 'testnet', account: '' }, 'balances'),
        /CacheScope\.account must not be empty/
      );
      assert.throws(
        () => buildScopedKey({ network: 'testnet', account: 'GD5J' }, ''),
        /resourceKey must not be empty/
      );
    });

    it('builds network and account prefixes correctly', () => {
      assert.equal(buildPrefix('testnet'), 'testnet:');
      assert.equal(buildPrefix('public', 'GD5J'), 'public:GD5J:');
      assert.throws(() => buildPrefix(''), /network must not be empty/);
    });

    it('parses valid scoped keys and rejects invalid formats', () => {
      const parsed = parseScopedKey('public:GA12345:transactions');
      assert.deepEqual(parsed, {
        network: 'public',
        account: 'GA12345',
        resourceKey: 'transactions',
      });

      const parsedWithNestedDelimiters = parseScopedKey('public:GA12345:orders:open:123');
      assert.deepEqual(parsedWithNestedDelimiters, {
        network: 'public',
        account: 'GA12345',
        resourceKey: 'orders:open:123',
      });

      assert.equal(parseScopedKey('invalid-key'), null);
      assert.equal(parseScopedKey('testnet:only-two-parts'), null);
      assert.equal(parseScopedKey('::'), null);
    });

    it('ScopedCache delegates operations with automatically prefixed keys', () => {
      const scope: CacheScope = { network: 'testnet', account: 'GA_SCOPED_TEST' };
      const scoped = cache.scoped(scope);

      assert.equal(scoped.buildKey('rates'), 'testnet:GA_SCOPED_TEST:rates');

      scoped.set('rates', { xlm: 0.15 });
      assert.deepEqual(scoped.get('rates'), { xlm: 0.15 });
      assert.deepEqual(cache.get('testnet:GA_SCOPED_TEST:rates'), { xlm: 0.15 });
      assert.equal(scoped.has('rates'), true);

      assert.equal(scoped.delete('rates'), true);
      assert.equal(scoped.has('rates'), false);
      assert.equal(cache.has('testnet:GA_SCOPED_TEST:rates'), false);
    });
  });

  describe('In-Flight Deduplication', () => {
    it('only calls the underlying fetcher once for concurrent requests with the same key', async () => {
      let callCount = 0;
      const delayedFetcher = async () => {
        callCount++;
        // Simulate async network latency
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { balance: '100.50' };
      };

      const key = 'testnet:GACCT:balances';

      // Fire 4 concurrent fetch requests
      const [res1, res2, res3, res4] = await Promise.all([
        cache.fetch(key, delayedFetcher),
        cache.fetch(key, delayedFetcher),
        cache.fetch(key, delayedFetcher),
        cache.fetch(key, delayedFetcher),
      ]);

      assert.equal(callCount, 1, 'Fetcher must be invoked exactly once');
      assert.deepEqual(res1, { balance: '100.50' });
      assert.deepEqual(res2, { balance: '100.50' });
      assert.deepEqual(res3, { balance: '100.50' });
      assert.deepEqual(res4, { balance: '100.50' });

      // After completion, in-flight count should be 0 and cache should contain the entry
      assert.equal(cache.inFlightCount, 0);
      assert.deepEqual(cache.get(key), { balance: '100.50' });
    });

    it('returns cached data without calling fetcher on subsequent calls within TTL', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { data: 'fresh' };
      };

      const key = 'testnet:GACCT:account_info';
      const result1 = await cache.fetch(key, fetcher);
      assert.equal(result1.data, 'fresh');
      assert.equal(callCount, 1);

      // Second call immediately afterwards
      const result2 = await cache.fetch(key, fetcher);
      assert.equal(result2.data, 'fresh');
      assert.equal(callCount, 1, 'Should return cached result without calling fetcher');
    });

    it('invokes separate fetchers for concurrent requests with different keys', async () => {
      let key1Calls = 0;
      let key2Calls = 0;

      const fetcher1 = async () => {
        key1Calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result1';
      };
      const fetcher2 = async () => {
        key2Calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result2';
      };

      const [r1, r2] = await Promise.all([
        cache.fetch('testnet:G1:key', fetcher1),
        cache.fetch('testnet:G2:key', fetcher2),
      ]);

      assert.equal(r1, 'result1');
      assert.equal(r2, 'result2');
      assert.equal(key1Calls, 1);
      assert.equal(key2Calls, 1);
    });

    it('cleans up in-flight map on error and propagates error to all concurrent callers', async () => {
      let callCount = 0;
      const failingFetcher = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 15));
        throw new Error('Network timeout (Horizon 504)');
      };

      const key = 'testnet:GERR:balances';

      const results = await Promise.allSettled([
        cache.fetch(key, failingFetcher),
        cache.fetch(key, failingFetcher),
      ]);

      assert.equal(callCount, 1);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');
      assert.equal(
        (results[0] as PromiseRejectedResult).reason.message,
        'Network timeout (Horizon 504)'
      );
      assert.equal(
        (results[1] as PromiseRejectedResult).reason.message,
        'Network timeout (Horizon 504)'
      );

      // Ensure in-flight map is clean and cache does not contain error data
      assert.equal(cache.inFlightCount, 0);
      assert.equal(cache.has(key), false);

      // Subsequent call should be able to retry
      let retryCount = 0;
      const successfulRetry = await cache.fetch(key, async () => {
        retryCount++;
        return { recovered: true };
      });
      assert.deepEqual(successfulRetry, { recovered: true });
      assert.equal(retryCount, 1);
    });

    it('bypasses cache when force option is true', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { count: callCount };
      };

      const key = 'testnet:GFORCE:data';
      const first = await cache.fetch(key, fetcher);
      assert.deepEqual(first, { count: 1 });

      const forced = await cache.fetch(key, fetcher, { force: true });
      assert.deepEqual(forced, { count: 2 });
      assert.equal(callCount, 2);
    });

    it('respects shouldCache predicate option', async () => {
      const key = 'testnet:GPRED:data';
      const res = await cache.fetch(
        key,
        async () => ({ valid: false, code: 404 }),
        { shouldCache: (data) => data.valid === true }
      );

      assert.deepEqual(res, { valid: false, code: 404 });
      assert.equal(cache.has(key), false, 'Should not have cached invalid result');
    });
  });

  describe('TTL Expiration', () => {
    it('expires cached data when TTL has elapsed', async () => {
      const key = 'testnet:GTTL:balances';
      cache.set(key, { balance: '500' }, 3_000); // 3 seconds TTL

      // At t = 1,000,000 (initial)
      assert.equal(cache.has(key), true);
      assert.deepEqual(cache.get(key), { balance: '500' });

      // Advance time by 2,999ms -> still valid
      currentTime += 2_999;
      assert.equal(cache.has(key), true);
      assert.deepEqual(cache.get(key), { balance: '500' });

      // Advance time past 3,000ms threshold -> expired
      currentTime += 1; // total +3000ms
      assert.equal(cache.has(key), false);
      assert.equal(cache.get(key), undefined);
    });

    it('fetches fresh data after TTL expiration', async () => {
      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return { version: fetchCount };
      };

      const key = 'public:GTTL2:prices';
      const r1 = await cache.fetch(key, fetcher, { ttl: 2_000 });
      assert.deepEqual(r1, { version: 1 });
      assert.equal(fetchCount, 1);

      // Advance clock by 1,000ms (within TTL)
      currentTime += 1_000;
      const r2 = await cache.fetch(key, fetcher, { ttl: 2_000 });
      assert.deepEqual(r2, { version: 1 });
      assert.equal(fetchCount, 1);

      // Advance clock by another 1,500ms (total 2,500ms > 2,000ms TTL)
      currentTime += 1_500;
      const r3 = await cache.fetch(key, fetcher, { ttl: 2_000 });
      assert.deepEqual(r3, { version: 2 });
      assert.equal(fetchCount, 2);
    });

    it('purgeExpired removes only expired entries', () => {
      cache.set('key1', 'v1', 1_000); // expires at 1,001,000
      cache.set('key2', 'v2', 5_000); // expires at 1,005,000
      cache.set('key3', 'v3', 10_000); // expires at 1,010,000

      assert.equal(cache.size, 3);

      // Advance to 1,002,000 (key1 expired, key2 & key3 valid)
      currentTime = 1_002_000;
      const purged = cache.purgeExpired();
      assert.equal(purged, 1);
      assert.equal(cache.size, 2);
      assert.equal(cache.has('key1'), false);
      assert.equal(cache.has('key2'), true);
      assert.equal(cache.has('key3'), true);
    });

    it('getEntry returns full metadata or undefined when expired', () => {
      const key = 'testnet:GMETA:entry';
      cache.set(key, 'value', 4_000);

      const entry = cache.getEntry<string>(key);
      assert.ok(entry);
      assert.equal(entry!.key, key);
      assert.equal(entry!.data, 'value');
      assert.equal(entry!.timestamp, 1_000_000);
      assert.equal(entry!.ttl, 4_000);
      assert.equal(entry!.expiresAt, 1_004_000);

      currentTime = 1_004_001;
      assert.equal(cache.getEntry(key), undefined);
    });

    it('works with node:test mock timers advancing Date clock', (t: { mock: typeof mock }) => {
      t.mock.timers.enable({ apis: ['Date'] });
      try {
        const timeCache = new DataCache({ defaultTtlMs: 3_000 });
        const key = 'testnet:GMOCK:balances';
        timeCache.set(key, { balance: '123' });

        assert.equal(timeCache.has(key), true);
        assert.deepEqual(timeCache.get(key), { balance: '123' });

        // Advance mock time by 2,500ms -> still valid
        t.mock.timers.tick(2_500);
        assert.equal(timeCache.has(key), true);

        // Advance mock time past 3,000ms -> expired
        t.mock.timers.tick(600);
        assert.equal(timeCache.has(key), false);
        assert.equal(timeCache.get(key), undefined);
      } finally {
        t.mock.timers.reset();
      }
    });
  });

  describe('Prefix-Based Invalidation', () => {
    beforeEach(() => {
      cache.set('testnet:GA_ALICE:balances', { xlm: '100' });
      cache.set('testnet:GA_ALICE:transactions', ['tx1', 'tx2']);
      cache.set('testnet:GB_BOB:balances', { xlm: '50' });
      cache.set('public:GA_ALICE:balances', { xlm: '1000' });
      cache.set('public:GC_CAROL:balances', { xlm: '2000' });
    });

    it('invalidates all keys belonging to a specific network', () => {
      const count = cache.invalidateNetwork('testnet');
      assert.equal(count, 3, 'Should remove all 3 testnet entries');

      assert.equal(cache.has('testnet:GA_ALICE:balances'), false);
      assert.equal(cache.has('testnet:GA_ALICE:transactions'), false);
      assert.equal(cache.has('testnet:GB_BOB:balances'), false);

      // Public network entries must remain intact
      assert.equal(cache.has('public:GA_ALICE:balances'), true);
      assert.equal(cache.has('public:GC_CAROL:balances'), true);
    });

    it('invalidates all keys belonging to a specific account on a network', () => {
      const count = cache.invalidateAccount('testnet', 'GA_ALICE');
      assert.equal(count, 2, 'Should remove 2 entries for GA_ALICE on testnet');

      assert.equal(cache.has('testnet:GA_ALICE:balances'), false);
      assert.equal(cache.has('testnet:GA_ALICE:transactions'), false);

      // Bob on testnet and Alice on public are untouched
      assert.equal(cache.has('testnet:GB_BOB:balances'), true);
      assert.equal(cache.has('public:GA_ALICE:balances'), true);
    });

    it('ScopedCache.invalidateAll removes all keys for its scope', () => {
      const aliceTestnet = cache.scoped({ network: 'testnet', account: 'GA_ALICE' });
      const removed = aliceTestnet.invalidateAll();
      assert.equal(removed, 2);

      assert.equal(aliceTestnet.has('balances'), false);
      assert.equal(aliceTestnet.has('transactions'), false);
      assert.equal(cache.has('testnet:GB_BOB:balances'), true);
    });

    it('clear() empties all entries and in-flight tracking', () => {
      assert.equal(cache.size, 5);
      cache.clear();
      assert.equal(cache.size, 0);
      assert.equal(cache.keys().length, 0);
    });
  });

  describe('Generation Counter & Stale Write Discarding', () => {
    it('discards mid-flight fetch results if network is switched before fetch resolves', async () => {
      let resolveSlowFetch!: (value: { network: string; balance: string }) => void;
      const slowFetchPromise = new Promise<{ network: string; balance: string }>(
        (resolve) => {
          resolveSlowFetch = resolve;
        }
      );

      const testnetScope: CacheScope = { network: 'testnet', account: 'GUSER1' };
      const publicScope: CacheScope = { network: 'public', account: 'GUSER1' };

      // 1. Start active on testnet
      cache.setScope(testnetScope);
      const testnetKey = buildScopedKey(testnetScope, 'balances');

      // 2. Initiate fetch on testnet (in flight)
      const fetchPromise = cache.fetch(testnetKey, () => slowFetchPromise);

      // 3. User switches network to public before testnet fetch completes
      cache.setScope(publicScope);

      // 4. Testnet fetch finishes now
      resolveSlowFetch({ network: 'testnet', balance: '999.00' });
      const result = await fetchPromise;

      // The returned promise gets the data, BUT it must NOT be written to the cache
      assert.deepEqual(result, { network: 'testnet', balance: '999.00' });
      assert.equal(
        cache.has(testnetKey),
        false,
        'Stale testnet result must NOT be cached after network switch'
      );
      assert.equal(cache.get(testnetKey), undefined);
    });

    it('discards mid-flight fetch results when explicit invalidation occurs mid-flight', async () => {
      let resolveFetch!: (val: string) => void;
      const pendingPromise = new Promise<string>((res) => {
        resolveFetch = res;
      });

      const key = 'testnet:GUSER2:transactions';
      const promise = cache.fetch(key, () => pendingPromise);

      // Invalidate key mid-flight
      cache.invalidate(key);

      // Resolve the fetch
      resolveFetch('stale_tx_list');
      const res = await promise;

      assert.equal(res, 'stale_tx_list');
      assert.equal(cache.has(key), false, 'Stale data must be discarded and not written to cache');
      assert.equal(cache.get(key), undefined);
    });

    it('discards mid-flight fetch results when prefix is invalidated mid-flight', async () => {
      let resolveTestnet!: (val: string) => void;
      let resolvePublic!: (val: string) => void;

      const pTestnet = new Promise<string>((res) => {
        resolveTestnet = res;
      });
      const pPublic = new Promise<string>((res) => {
        resolvePublic = res;
      });

      const testnetKey = 'testnet:GUSER3:balances';
      const publicKey = 'public:GUSER3:balances';

      const fetchTestnet = cache.fetch(testnetKey, () => pTestnet);
      const fetchPublic = cache.fetch(publicKey, () => pPublic);

      // Invalidate ONLY testnet prefix
      cache.invalidateNetwork('testnet');

      // Resolve both fetches
      resolveTestnet('testnet_data');
      resolvePublic('public_data');

      await Promise.all([fetchTestnet, fetchPublic]);

      // Testnet data was discarded due to generation bump
      assert.equal(cache.has(testnetKey), false);
      assert.equal(cache.get(testnetKey), undefined);

      // Public data was NOT invalidated and should be successfully cached
      assert.equal(cache.has(publicKey), true);
      assert.equal(cache.get(publicKey), 'public_data');
    });

    it('allows fresh fetches after invalidation with updated generation counter', async () => {
      const key = 'testnet:GGEN:rates';

      // 1. Initial fetch
      await cache.fetch(key, async () => ({ rate: 1 }));
      assert.deepEqual(cache.get(key), ({ rate: 1 }));

      // 2. Invalidate
      cache.invalidate(key);
      assert.equal(cache.has(key), false);

      // 3. New fetch starts in the new generation
      await cache.fetch(key, async () => ({ rate: 2 }));
      assert.deepEqual(cache.get(key), ({ rate: 2 }));
    });
  });

  describe('Subscribe & Notify Mechanism (useSyncExternalStore compatibility)', () => {
    it('notifies subscribers on set, delete, invalidate, clear, and scope changes', () => {
      let notificationCount = 0;
      const unsubscribe = cache.subscribe(() => {
        notificationCount++;
      });

      const initialSnapshot = cache.getSnapshot();

      // 1. Set mutation
      cache.set('testnet:GSUB:data', 'value1');
      assert.equal(notificationCount, 1);
      assert.equal(cache.getSnapshot(), initialSnapshot + 1);

      // 2. Delete mutation
      cache.delete('testnet:GSUB:data');
      assert.equal(notificationCount, 2);
      assert.equal(cache.getSnapshot(), initialSnapshot + 2);

      // 3. Invalidate mutation
      cache.invalidate('testnet:GSUB:data');
      assert.equal(notificationCount, 3);
      assert.equal(cache.getSnapshot(), initialSnapshot + 3);

      // 4. Invalidate prefix
      cache.invalidatePrefix('testnet:');
      assert.equal(notificationCount, 4);
      assert.equal(cache.getSnapshot(), initialSnapshot + 4);

      // 5. Scope change
      cache.setScope({ network: 'public', account: 'GSUB' });
      assert.equal(notificationCount, 5);
      assert.equal(cache.getSnapshot(), initialSnapshot + 5);

      // 6. Clear
      cache.clear();
      assert.equal(notificationCount, 6);
      assert.equal(cache.getSnapshot(), initialSnapshot + 6);

      // 7. Unsubscribe stops receiving notifications
      unsubscribe();
      cache.set('testnet:GSUB:after', 'v');
      assert.equal(notificationCount, 6);
    });

    it('does not notify subscribers when a mid-flight fetch is discarded', async () => {
      let notificationCount = 0;
      cache.subscribe(() => {
        notificationCount++;
      });

      let resolveSlow!: (val: string) => void;
      const slowPromise = new Promise<string>((res) => {
        resolveSlow = res;
      });

      const key = 'testnet:GDISC:data';
      const fetchPromise = cache.fetch(key, () => slowPromise);

      // Invalidate while in-flight (+1 notification for invalidate)
      cache.invalidate(key);
      assert.equal(notificationCount, 1);

      // Resolve the discarded fetch
      resolveSlow('discarded_value');
      await fetchPromise;

      // Notification count should STILL be 1 (no spurious write notification)
      assert.equal(notificationCount, 1);
    });

    it('detailed listener receives structured change events', () => {
      const events: string[] = [];
      const unsubscribe = cache.subscribeDetailed((e) => {
        events.push(`${e.type}:${e.key ?? e.prefix ?? ''}`);
      });

      cache.set('testnet:GEVT:1', 'val');
      cache.invalidate('testnet:GEVT:1');
      cache.invalidatePrefix('testnet:');
      cache.clear();

      assert.deepEqual(events, [
        'set:testnet:GEVT:1',
        'invalidate:testnet:GEVT:1',
        'invalidate:testnet:',
        'clear:',
      ]);

      unsubscribe();
    });

    it('safely catches errors thrown by rogue subscribers without breaking cache operations', () => {
      let healthyCalled = false;
      cache.subscribe(() => {
        throw new Error('Rogue subscriber crash!');
      });
      cache.subscribe(() => {
        healthyCalled = true;
      });

      // Performing set should not throw despite the rogue subscriber
      assert.doesNotThrow(() => {
        cache.set('testnet:GSAFE:key', 'value');
      });
      assert.equal(healthyCalled, true);
      assert.equal(cache.get('testnet:GSAFE:key'), 'value');
    });
  });

  describe('Factory & Default Export', () => {
    it('createCache factory creates a new independent DataCache instance', () => {
      const customCache = createCache({ defaultTtlMs: 10_000 });
      assert.ok(customCache instanceof DataCache);
      assert.equal(customCache.defaultTtlMs, 10_000);
      assert.notEqual(customCache, cache);
    });
  });
});
