/**
 * The one thing left of Pollar: removing it from devices that still hold its wallets
 * (`purgeLegacyPollar` in src/lib/vault.ts).
 *
 * A Pollar wallet's key was in Pollar's KMS; the device held an entry and a sealed session.
 * With the Pollar code gone such an entry opens nothing and signs nothing, so it goes — but
 * the testnet half a Pollar login left beside it is an ordinary seed wallet whose seed is
 * ONLY here, and removing it would be losing a key. What is pinned is that split, plus the
 * active wallet moving somewhere real and the notice being said exactly once.
 */
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getActiveId, listWallets, purgeLegacyPollar, takeLegacyPollarNotice } from '@/lib/vault';

class MemoryStorage {
  map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const mem = new MemoryStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = mem;

const base = { name: 'Ada', birthdate: '', email: 'ada@example.com', createdAt: 1 };

beforeEach(() => mem.clear());

test('a Pollar wallet and its session go; its testnet half stays, visible, as an ordinary wallet', async () => {
  mem.setItem(
    'cosmos.wallets',
    JSON.stringify([
      { ...base, id: 'p1', kind: 'pollar', pollarUserId: 'u1', pollarProvider: 'google', publicKey: 'GPOLLAR', migratedTo: 't1' },
      { ...base, id: 't1', testnetFor: 'p1', publicKey: 'GTEST' },
      { ...base, id: 'l1', publicKey: 'GLOCAL' },
    ]),
  );
  mem.setItem('cosmos.active', 'p1');
  mem.setItem('cosmos.pollar.p1', '{"sealed":"session"}');
  mem.setItem('cosmos.pay.p1', '{"sealed":"keys"}');
  mem.setItem('cosmos.w.t1', '{"sealed":"seed"}');

  assert.equal(await purgeLegacyPollar(), 1);

  const list = await listWallets();
  assert.deepEqual(
    list.map((w) => w.id),
    ['t1', 'l1'],
  );
  // No trace of the Pollar shape on what is kept.
  for (const w of list) {
    const raw = w as unknown as Record<string, unknown>;
    for (const k of ['kind', 'testnetFor', 'migratedTo', 'pollarUserId', 'pollarProvider']) assert.equal(raw[k], undefined, k);
  }
  assert.equal(mem.getItem('cosmos.pollar.p1'), null, 'the Pollar session is gone');
  assert.equal(mem.getItem('cosmos.pay.p1'), null, 'and the credential sealed beside it');
  assert.equal(mem.getItem('cosmos.w.t1'), '{"sealed":"seed"}', 'the testnet seed is untouched');
  assert.equal(await getActiveId(), 't1', 'the active wallet moves to one that exists');

  assert.equal(await takeLegacyPollarNotice(), 1, 'the notice is said…');
  assert.equal(await takeLegacyPollarNotice(), 0, '…once');
  assert.equal(await purgeLegacyPollar(), 0, 'and the clean-up has nothing left to do');
});

test('a device with no Pollar wallet is left exactly as it was', async () => {
  const wallets = JSON.stringify([{ ...base, id: 'l1', publicKey: 'GLOCAL' }]);
  mem.setItem('cosmos.wallets', wallets);
  mem.setItem('cosmos.active', 'l1');
  assert.equal(await purgeLegacyPollar(), 0);
  assert.equal(mem.getItem('cosmos.wallets'), wallets);
  assert.equal(await takeLegacyPollarNotice(), 0);
});

test('a device whose only wallet was Pollar ends with none, and no active id', async () => {
  mem.setItem('cosmos.wallets', JSON.stringify([{ ...base, id: 'p1', kind: 'pollar', publicKey: 'GPOLLAR' }]));
  mem.setItem('cosmos.active', 'p1');
  assert.equal(await purgeLegacyPollar(), 1);
  assert.deepEqual(await listWallets(), []);
  assert.equal(await getActiveId(), null);
});
