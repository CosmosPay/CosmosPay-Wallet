import '../test-setup.ts';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import dataCache from '../lib/cache.ts';
import { useScopedData } from './useScopedData.ts';

describe('useScopedData hook', () => {
  beforeEach(() => {
    dataCache.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts and successfully fetches and returns scoped data', async () => {
    let callCount = 0;
    const { result } = renderHook(() =>
      useScopedData('testnet', 'GACC_SUCCESS', 'balances', async () => {
        callCount++;
        return { xlm: '250.00', usd: '25.00' };
      })
    );

    // Initially loading
    assert.equal(result.current.isLoading, true);
    assert.equal(result.current.data, undefined);
    assert.equal(result.current.error, null);

    // Wait for resolution
    await waitFor(() => {
      assert.equal(result.current.isLoading, false);
    });

    assert.deepEqual(result.current.data, { xlm: '250.00', usd: '25.00' });
    assert.equal(result.current.error, null);
    assert.equal(callCount, 1);
  });

  it('seamlessly drops old network data during mid-flight network switch and avoids stale writes', async () => {
    let resolveTestnet!: (val: { network: string; balance: string }) => void;
    const testnetPromise = new Promise<{ network: string; balance: string }>(
      (res) => {
        resolveTestnet = res;
      }
    );

    const { result, rerender } = renderHook(
      ({ net }: { net: string }) =>
        useScopedData(
          net,
          'GUSER_SWITCH',
          'balances',
          async () => {
            if (net === 'testnet') {
              return testnetPromise;
            }
            return { network: 'public', balance: '1200.00' };
          }
        ),
      { initialProps: { net: 'testnet' } }
    );

    // Initial testnet fetch in flight
    assert.equal(result.current.isLoading, true);
    assert.equal(result.current.data, undefined);

    // User switches network to 'public' mid-flight
    dataCache.setScope({ network: 'public', account: 'GUSER_SWITCH' });
    rerender({ net: 'public' });

    // Wait for public data to resolve
    await waitFor(() => {
      assert.deepEqual(result.current.data, {
        network: 'public',
        balance: '1200.00',
      });
    });

    assert.equal(result.current.isLoading, false);

    // Later, the old testnet fetch resolves
    resolveTestnet({ network: 'testnet', balance: '10.00' });

    // Verify: component continues displaying public data, and testnet data was not cached
    assert.deepEqual(result.current.data, {
      network: 'public',
      balance: '1200.00',
    });
    assert.equal(dataCache.has('testnet:GUSER_SWITCH:balances'), false);
    assert.equal(dataCache.get('testnet:GUSER_SWITCH:balances'), undefined);
  });

  it('automatically refetches fresh data when prefix invalidation clears cached data', async () => {
    let fetchCount = 0;
    const { result } = renderHook(() =>
      useScopedData('testnet', 'GUSER_INVAL', 'balances', async () => {
        fetchCount++;
        return { fetchCount, balance: `${fetchCount * 100}.00` };
      })
    );

    // 1. Initial fetch completes
    await waitFor(() => {
      assert.deepEqual(result.current.data, { fetchCount: 1, balance: '100.00' });
    });
    assert.equal(fetchCount, 1);

    // 2. Perform write / mutation and invalidate by prefix via ScopedCache.invalidateAll()
    act(() => {
      const scoped = dataCache.scoped({
        network: 'testnet',
        account: 'GUSER_INVAL',
      });
      scoped.invalidateAll();
    });

    // 3. Hook detects data dropped to undefined and automatically re-runs fetcher
    await waitFor(() => {
      assert.deepEqual(result.current.data, { fetchCount: 2, balance: '200.00' });
    });
    assert.equal(fetchCount, 2);
  });

  it('deduplicates in-flight requests across multiple mounted components with exact same scope and key', async () => {
    let fetchCount = 0;
    const sharedFetcher = async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { profileName: 'Alice', id: fetchCount };
    };

    const hook1 = renderHook(() =>
      useScopedData('testnet', 'GSHARED_USER', 'profile', sharedFetcher)
    );
    const hook2 = renderHook(() =>
      useScopedData('testnet', 'GSHARED_USER', 'profile', sharedFetcher)
    );

    await Promise.all([
      waitFor(() => {
        assert.deepEqual(hook1.result.current.data, {
          profileName: 'Alice',
          id: 1,
        });
      }),
      waitFor(() => {
        assert.deepEqual(hook2.result.current.data, {
          profileName: 'Alice',
          id: 1,
        });
      }),
    ]);

    // Ensure underlying fetcher was executed ONLY once for both mounted components
    assert.equal(
      fetchCount,
      1,
      'Fetcher must only be called once for concurrent mounted components'
    );
  });

  it('only re-renders component when its specific key changes and NOT on unrelated store mutations', async () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useScopedData(
        'testnet',
        'GALICE_SPECIFIC',
        'balances',
        async () => ({ xlm: 50 })
      );
    });

    await waitFor(() => {
      assert.deepEqual(result.current.data, { xlm: 50 });
    });

    const rendersAfterInitial = renderCount;

    // Mutate unrelated keys in the cache store
    act(() => {
      dataCache.set('public:GALICE_SPECIFIC:balances', { xlm: 999 });
      dataCache.set('testnet:GBOB:balances', { xlm: 300 });
      dataCache.set('testnet:GALICE_SPECIFIC:transactions', ['tx1']);
    });

    // Verify this component did NOT re-render
    assert.equal(
      renderCount,
      rendersAfterInitial,
      'Component must not re-render when other store keys are updated'
    );
  });

  it('captures and exposes errors when fetcher fails', async () => {
    const { result } = renderHook(() =>
      useScopedData('testnet', 'GERR_USER', 'account', async () => {
        throw new Error('Stellar Horizon 404: Account not funded');
      })
    );

    await waitFor(() => {
      assert.equal(result.current.isLoading, false);
      assert.ok(result.current.error);
    });

    assert.equal(
      result.current.error?.message,
      'Stellar Horizon 404: Account not funded'
    );
    assert.equal(result.current.data, undefined);
  });

  it('does not trigger fetch when enabled is false', () => {
    let fetchCount = 0;
    const { result } = renderHook(() =>
      useScopedData(
        'testnet',
        'GDISABLED',
        'balances',
        async () => {
          fetchCount++;
          return { data: 'never' };
        },
        { enabled: false }
      )
    );

    assert.equal(result.current.isLoading, false);
    assert.equal(result.current.data, undefined);
    assert.equal(fetchCount, 0);
  });
});
