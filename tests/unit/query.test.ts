/**
 * The keyed read cache. Each test here corresponds to a real defect in the previous
 * fetch-on-every-render approach.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { invalidate, isFresh, peek, resetCache, run, subscribe } from '@/lib/query';
import { ACCOUNT_PREFIX, accountKey, historyKey, scopeKey } from '@/lib/dataKeys';

beforeEach(() => resetCache());

const PUB = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

test('concurrent callers share ONE request', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'value';
  };
  // Home -> History used to fire getHistory twice within a second.
  const [a, b, c] = await Promise.all([
    run({ key: 'k', fetcher }),
    run({ key: 'k', fetcher }),
    run({ key: 'k', fetcher }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], ['value', 'value', 'value']);
});

test('a fresh value short-circuits the network', async () => {
  let calls = 0;
  const fetcher = async () => `v${++calls}`;
  assert.equal(await run({ key: 'k', fetcher, ttl: 10_000 }), 'v1');
  assert.equal(await run({ key: 'k', fetcher, ttl: 10_000 }), 'v1');
  assert.equal(calls, 1);
  assert.ok(isFresh('k', 10_000));
  // force bypasses the TTL — what an explicit pull-to-refresh does.
  assert.equal(await run({ key: 'k', fetcher, ttl: 10_000 }, true), 'v2');
  assert.equal(calls, 2);
});

test('a zero TTL always refetches', async () => {
  let calls = 0;
  const fetcher = async () => `v${++calls}`;
  await run({ key: 'k', fetcher });
  await run({ key: 'k', fetcher });
  assert.equal(calls, 2);
});

test('an invalidated in-flight result is DISCARDED — the stale-write race', async () => {
  // The original bug: switchNetwork cleared the balance, then the previous network's
  // in-flight getAccountState resolved and wrote itself in.
  let release: (v: string) => void = () => {};
  const slow = () => new Promise<string>((r) => (release = r));
  const p = run({ key: 'k', fetcher: slow });
  invalidate('k'); // network changed while the request was in flight
  release('stale value from the old network');
  await p;
  assert.equal(peek<string>('k').data, undefined, 'a stale result was written into the cache');
});

test('invalidate works by prefix, so a whole domain clears at once', async () => {
  await run({ key: accountKey('testnet', PUB), fetcher: async () => 'a' });
  await run({ key: accountKey('public', PUB), fetcher: async () => 'b' });
  await run({ key: historyKey('testnet', PUB), fetcher: async () => 'h' });
  invalidate(ACCOUNT_PREFIX);
  assert.equal(peek(accountKey('testnet', PUB)).data, undefined);
  assert.equal(peek(accountKey('public', PUB)).data, undefined);
  assert.equal(peek(historyKey('testnet', PUB)).data, 'h', 'history should be untouched');
});

test('scoping by network+account makes cross-network bleed impossible', async () => {
  await run({ key: accountKey('testnet', PUB), fetcher: async () => 'testnet balance' });
  // Reading the mainnet key cannot see the testnet value — different key, by design.
  assert.equal(peek(accountKey('public', PUB)).data, undefined);
  assert.notEqual(scopeKey('testnet', PUB), scopeKey('public', PUB));
});

test('subscribers are notified once per settled write', async () => {
  let hits = 0;
  const off = subscribe('k', () => hits++);
  await run({ key: 'k', fetcher: async () => 1 });
  assert.equal(hits, 1);
  off();
  await run({ key: 'k', fetcher: async () => 2 }, true);
  assert.equal(hits, 1, 'unsubscribed listener still fired');
});

test('retry is opt-in and bounded', async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new Error('network');
    return 'ok';
  };
  assert.equal(await run({ key: 'k', fetcher: flaky, retry: 2 }), 'ok');
  assert.equal(calls, 3);
});

test('without retry, one failure is one failure — money paths must not repeat', async () => {
  let calls = 0;
  const failing = async () => {
    calls++;
    throw new Error('boom');
  };
  await assert.rejects(() => run({ key: 'k', fetcher: failing }));
  assert.equal(calls, 1, 'a non-idempotent call was retried');
});

test('an error is recorded and does not poison the next attempt', async () => {
  await assert.rejects(() => run({ key: 'k', fetcher: async () => { throw new Error('boom'); } }));
  assert.ok(peek('k').error);
  assert.equal(await run({ key: 'k', fetcher: async () => 'recovered' }), 'recovered');
  assert.equal(peek<string>('k').data, 'recovered');
  assert.equal(peek('k').error, undefined);
});
