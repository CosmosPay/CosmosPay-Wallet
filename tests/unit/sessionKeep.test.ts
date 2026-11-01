/**
 * The kept session (src/lib/sessionKeep.ts), on an in-memory backend. What is pinned: the vault
 * key comes back as it was sealed, and only inside its auto-lock window; a record that is
 * expired, dated in the future, naming an endless window or moved to another wallet is dropped,
 * never opened; a lock right after keeping still finds the bytes it kept; and a restored session
 * lands on the screen it was on unless that screen needs a flow's passing data.
 */
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EARN_ENABLED } from '@/constants/features';
import { importVaultKey, newKdfParams } from '@/lib/crypto';
import {
  dropKeptSession,
  isLive,
  keepSession,
  landingScreen,
  restoreKeptSession,
  setKeepBackend,
  touchKeptSession,
  type KeepBackend,
} from '@/lib/sessionKeep';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
let mem: Map<string, unknown>;

beforeEach(() => {
  mem = new Map();
  const backend: KeepBackend = {
    get: async (k) => mem.get(k),
    put: async (k, v) => void mem.set(k, v),
    del: async (k) => void mem.delete(k),
  };
  setKeepBackend(backend);
});

const vaultKey = async () => importVaultKey(globalThis.crypto.getRandomValues(new Uint8Array(32)), newKdfParams());

test('the key comes back as it was kept, with the place and the wallet', async () => {
  const vk = await vaultKey();
  const want = Uint8Array.from(vk.raw);
  await keepSession('w1', vk, DAY, { screen: 'settings', tab: 'profile' }, 1_000);
  const back = await restoreKeptSession(1_000 + HOUR);
  assert.ok(back);
  assert.equal(back.walletId, 'w1');
  assert.deepEqual(Array.from(back.vaultKey.raw), Array.from(want));
  assert.deepEqual(back.vaultKey.kdf, vk.kdf);
  assert.deepEqual(back.place, { screen: 'settings', tab: 'profile' });
});

test('the bytes are copied when kept: a lock zeroing them right after changes nothing', async () => {
  const vk = await vaultKey();
  const want = Array.from(vk.raw);
  const kept = keepSession('w1', vk, DAY, null, 0);
  vk.raw.fill(0); // what lock() does, before the write ran
  await kept;
  assert.deepEqual(Array.from((await restoreKeptSession(1))!.vaultKey.raw), want);
});

test('past its auto-lock window it is dropped, key and record', async () => {
  await keepSession('w1', await vaultKey(), HOUR, null, 0);
  assert.equal(await restoreKeptSession(HOUR + 1), null);
  assert.equal(mem.size, 0);
});

test('activity moves the window; a shorter auto-lock shortens it', async () => {
  await keepSession('w1', await vaultKey(), HOUR, null, 0);
  await touchKeptSession({ lastActive: 50 * 60_000 });
  assert.ok(await restoreKeptSession(HOUR + 1));
  await touchKeptSession({ lastActive: 0, lockMs: 15 * 60_000 });
  assert.equal(await restoreKeptSession(16 * 60_000), null);
});

test('a record dated in the future or naming an endless window is not trusted', () => {
  assert.equal(isLive(10 * 60_000, DAY, 0), false);
  assert.equal(isLive(0, Number.MAX_SAFE_INTEGER, 8 * DAY), false);
  assert.equal(isLive(0, DAY, DAY - 1), true);
});

test('a record moved to another wallet does not open: the key is bound to its wallet', async () => {
  await keepSession('w1', await vaultKey(), DAY, null, 0);
  mem.set('session', { ...(mem.get('session') as object), walletId: 'w2' });
  assert.equal(await restoreKeptSession(1), null);
  assert.equal(mem.size, 0);
});

test('a drop forgets it, even one queued right behind the keep', async () => {
  void keepSession('w1', await vaultKey(), DAY, null, 0);
  await dropKeptSession();
  assert.equal(await restoreKeptSession(1), null);
});

test('the landing screen: the one it was on, unless it needs a flow it no longer has', () => {
  assert.equal(landingScreen(null), 'home');
  assert.equal(landingScreen({ screen: 'settings', tab: 'profile' }), 'settings');
  assert.equal(landingScreen({ screen: 'wallets', tab: 'wallet' }), 'wallets');
  assert.equal(landingScreen({ screen: 'confirm', tab: 'home' }), 'home');
  assert.equal(landingScreen({ screen: 'export', tab: 'profile' }), 'profile');
  assert.equal(landingScreen({ screen: 'unlock', tab: 'home' }), 'home');
  // a place in a switched-off section (constants/features.ts) lands on Home
  if (!EARN_ENABLED) {
    assert.equal(landingScreen({ screen: 'defindex', tab: 'earn' }), 'home');
    assert.equal(landingScreen({ screen: 'lp-deposit', tab: 'earn' }), 'home');
  }
});
