import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  addWallet,
  clearCosmosPay,
  clearPendingCosmosPay,
  clearReceiver,
  destroyAll,
  getActiveEntry,
  getActiveId,
  getCosmosPay,
  getPendingCosmosPay,
  getCustomNetworks,
  getNetworkId,
  hasAnyWallet,
  listWallets,
  migrate,
  removeWallet,
  saveCosmosPay,
  saveDefaultReceiver,
  savePendingCosmosPay,
  setCustomNetworks,
  setNetworkId,
  unlockWallet,
  updateWalletMeta,
  verifyPassword,
  changePassword,
} from '@/lib/vault';

const PASSWORD = 'Str0ngPass!';
const secret = (n: number) => ({ secret: `S${'A'.repeat(55)}${n}`, mnemonic: `word${n} `.repeat(12).trim() });

function info(pub: string, name = 'Alex') {
  return { publicKey: pub, name, birthdate: '2000-01-01', email: `a${pub.slice(-3)}@x.co` };
}

beforeEach(async () => {
  // Fresh storage per test (the stub is installed by tests/unit/register.mjs).
  globalThis.localStorage.clear();
});

test('add + list + active wallet', async () => {
  assert.equal(await hasAnyWallet(), false);
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  assert.equal((await listWallets()).length, 1);
  assert.equal(await getActiveId(), entry.id);
  assert.equal(await hasAnyWallet(), true);
});

test('duplicate public key re-activates instead of duplicating', async () => {
  const pub = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const a = await addWallet(secret(1), info(pub, 'one'), PASSWORD);
  const b = await addWallet(secret(2), info(pub, 'two'), PASSWORD);
  assert.equal((await listWallets()).length, 1);
  assert.equal(b.id, a.id);
  assert.equal(await getActiveId(), a.id);
});

test('unlock decrypts the sealed secret; wrong password throws', async () => {
  const entry = await addWallet(secret(7), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  const got = await unlockWallet(entry.id, PASSWORD);
  assert.equal(got.secret, secret(7).secret);
  await assert.rejects(() => unlockWallet(entry.id, 'wrong'), /Contraseña incorrecta/);
});

test('verifyPassword checks the active wallet', async () => {
  await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  assert.equal(await verifyPassword(PASSWORD), true);
  assert.equal(await verifyPassword('nope'), false);
  assert.equal(await verifyPassword(''), false);
});

test('updateWalletMeta patches plaintext fields', async () => {
  const pub = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const entry = await addWallet(secret(1), info(pub), PASSWORD);
  const next = await updateWalletMeta(entry.id, { name: 'Renamed', email: 'new@x.co' });
  assert.equal(next.find((w) => w.id === entry.id)?.name, 'Renamed');
  assert.equal(next.find((w) => w.id === entry.id)?.email, 'new@x.co');
});

test('removeWallet drops the vault and reselects the active wallet', async () => {
  const pub = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const a = await addWallet(secret(1), info(pub, 'one'), PASSWORD);
  const b = await addWallet(secret(2), info('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'two'), PASSWORD);
  const { remaining, newActive } = await removeWallet(a.id);
  assert.equal(remaining.length, 1);
  assert.equal(newActive, b.id);
  assert.equal(await getActiveId(), b.id);
  // removing the last wallet clears the active key
  await removeWallet(b.id);
  assert.equal(await getActiveId(), null);
  assert.equal(await listWallets().then((l) => l.length), 0);
});

test('changePassword re-seals every wallet under the new password', async () => {
  const pub = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const entry = await addWallet(secret(3), info(pub), PASSWORD);
  await changePassword(PASSWORD, 'NewPass123');
  assert.equal((await unlockWallet(entry.id, 'NewPass123')).secret, secret(3).secret);
  await assert.rejects(() => unlockWallet(entry.id, PASSWORD));
});

test('migrate converts the legacy single-wallet format', async () => {
  globalThis.localStorage.setItem('cosmos.vault', JSON.stringify('legacy-sealed-blob'));
  globalThis.localStorage.setItem('cosmos.meta', JSON.stringify({ publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', name: 'viejo', network: 'public' }));
  await migrate();
  const list = await listWallets();
  assert.equal(list.length, 1);
  assert.equal(list[0].publicKey, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(list[0].name, 'viejo');
  assert.equal(await getNetworkId(), 'public');
  assert.equal(globalThis.localStorage.getItem('cosmos.vault'), null); // old keys removed
});

test('migrate is a no-op once the new format exists', async () => {
  await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  globalThis.localStorage.setItem('cosmos.vault', 'legacy');
  await migrate();
  assert.equal((await listWallets()).length, 1); // not doubled
});

test('CosmosPay keys seal at rest and round-trip', async () => {
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  const account = { keys: { dev: 'dev-key', prod: 'prod-key' }, organizationId: 'org-1' };
  const list = await saveCosmosPay(entry.id, account, PASSWORD);
  assert.equal(list.find((w) => w.id === entry.id)?.cosmosPayEnabled, true);
  assert.equal(list.find((w) => w.id === entry.id)?.cosmosPayOrgId, 'org-1');
  const got = await getCosmosPay(entry.id, PASSWORD);
  assert.deepEqual(got, account);
  assert.equal(await getCosmosPay(entry.id, 'wrong'), null);
});

test('legacy single-key CosmosPay shape migrates to the dual-key shape', async () => {
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  const legacy = { apiKey: 'old-key', organizationId: 'org-2', environment: 'dev' as const };
  await saveCosmosPay(entry.id, legacy as never, PASSWORD);
  const got = await getCosmosPay(entry.id, PASSWORD);
  assert.deepEqual(got, { organizationId: 'org-2', keys: { dev: 'old-key', prod: null } });
});

test('pending registration round-trips and clears', async () => {
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  const pending = { claimToken: 'tok', stellarAddress: 'G...', expiresAt: 123456 };
  await savePendingCosmosPay(entry.id, pending);
  assert.deepEqual(await getPendingCosmosPay(entry.id), pending);
  await clearPendingCosmosPay(entry.id);
  assert.equal(await getPendingCosmosPay(entry.id), null);
});

test('default receiver + clear receiver', async () => {
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  await saveDefaultReceiver(entry.id, 'recv-1');
  assert.equal((await listWallets())[0].cosmosPayReceiverId, 'recv-1');
  await clearReceiver(entry.id);
  assert.equal((await listWallets())[0].cosmosPayReceiverId, undefined);
});

test('clearCosmosPay drops keys + pending + flags', async () => {
  const entry = await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  await saveCosmosPay(entry.id, { keys: { dev: 'k', prod: null }, organizationId: 'o' }, PASSWORD);
  await savePendingCosmosPay(entry.id, { claimToken: 't', stellarAddress: 'G', expiresAt: 1 });
  const list = await clearCosmosPay(entry.id);
  assert.equal(list.find((w) => w.id === entry.id)?.cosmosPayEnabled, false);
  assert.equal(await getCosmosPay(entry.id, PASSWORD), null);
  assert.equal(await getPendingCosmosPay(entry.id), null);
});

test('network + custom networks persist', async () => {
  await setNetworkId('public');
  assert.equal(await getNetworkId(), 'public');
  const cfg = { id: 'custom-x', label: 'X', horizon: 'https://h', passphrase: 'p', custom: true };
  await setCustomNetworks([cfg]);
  assert.deepEqual(await getCustomNetworks(), [cfg]);
});

test('destroyAll wipes every wallet and the active key', async () => {
  await addWallet(secret(1), info('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), PASSWORD);
  await destroyAll();
  assert.equal(await hasAnyWallet(), false);
  assert.equal(await getActiveEntry(), null);
});
