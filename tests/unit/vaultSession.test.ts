/**
 * The session key: one derivation per unlock, one key for every box on the device.
 *
 * This is what replaced keeping the app password in memory (`src/state/store.ts`'s
 * `Session`), and it only works if two things hold. Every box has to end up under the SAME
 * parameters, or a key derived at unlock cannot open the wallet the user switches to; and
 * boxes written by older releases have to keep opening while that happens, or the upgrade
 * is a bricked wallet with no error anyone can act on. Both failures are silent, which is
 * why they are tested here rather than left to a device.
 *
 * It reaches the real `lib/storage` rather than a stub of it: off Tauri and outside an
 * extension page that module writes to `localStorage`, so supplying one exercises the whole
 * path, storage included. The crypto underneath has its own file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VaultKeyMismatchError,
  WrongPasswordError,
  deriveVaultKey,
  kdfOf,
  newKdfParams,
  sameKdf,
  type SealedBox,
} from '@/lib/crypto';
import { PBKDF2_ITERATIONS } from '@/constants/crypto';
import {
  addWallet,
  changePassword,
  convergeSeals,
  getCosmosPay,
  openVault,
  saveCosmosPay,
  unlockSession,
  verifyVaultKey,
} from '@/lib/vault';
import { legacyBox } from '../legacyBox.ts';

/** The smallest thing that answers what `lib/storage`'s web branch asks of it. */
class MemoryStorage {
  private map = new Map<string, string>();
  /** One key whose writes refuse, for the tests that need a storage fault mid-pass. */
  private refuse: string | null = null;
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
    if (key === this.refuse) throw new Error('storage refused this write');
    this.map.set(key, String(value));
  }
  failOn(key: string | null): void {
    this.refuse = key;
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

const PWD = 'Correct-Horse-12';
const NEXT_PWD = 'Battery-Staple-34';
const vaultKeyOf = (id: string) => `cosmos.w.${id}`;
const payKeyOf = (id: string) => `cosmos.pay.${id}`;
const secretOf = (id: string) => ({ secret: `SB${id.toUpperCase()}`, mnemonic: 'a b c' });
const storedBox = (key: string): SealedBox => JSON.parse(mem.getItem(key) ?? 'null') as SealedBox;

/** Wallets on the device, each sealed however the caller says. Wallet 0 is the active one. */
async function install(ids: string[], seal: (id: string) => Promise<SealedBox>): Promise<void> {
  mem.clear();
  mem.setItem(
    'cosmos.wallets',
    JSON.stringify(
      ids.map((id) => ({ id, publicKey: `G${id}`, name: id, birthdate: '', email: '', createdAt: 0 })),
    ),
  );
  mem.setItem('cosmos.active', ids[0]);
  for (const id of ids) mem.setItem(vaultKeyOf(id), JSON.stringify(await seal(id)));
}

/** Every box a release before this one would have written: its own salt, the old cost. */
const asLegacy = (id: string) => legacyBox(JSON.stringify(secretOf(id)), PWD);

/* ------------------------------ opening at all ------------------------------ */

test('a wallet sealed by an older release still unlocks', async () => {
  // Before anything else. Everything below is pointless if the upgrade cannot read what is
  // already on the device.
  await install(['w1'], asLegacy);
  const { entry, vaultKey } = await unlockSession(PWD);
  assert.equal(entry.id, 'w1');
  assert.deepEqual(await openVault('w1', vaultKey), secretOf('w1'));
});

test('a wrong password is a wrong password, not a broken box', async () => {
  await install(['w1'], asLegacy);
  await assert.rejects(() => unlockSession('not the password'), WrongPasswordError);
});

/* ------------------------------- convergence ------------------------------- */

test('converging puts every wallet under one key, at the current cost', async () => {
  // Two wallets sealed by an older release carry two different salts, so the key that
  // opened the active one cannot open the other. That is the state a session would have
  // started in, and `switchWallet` is where the user would have found out.
  await install(['w1', 'w2'], asLegacy);
  const opened = await unlockSession(PWD);
  await assert.rejects(() => openVault('w2', opened.vaultKey), VaultKeyMismatchError);

  const vaultKey = await convergeSeals(PWD, opened.vaultKey);

  assert.equal(vaultKey.kdf.iter, PBKDF2_ITERATIONS);
  assert.deepEqual(await openVault('w1', vaultKey), secretOf('w1'));
  assert.deepEqual(await openVault('w2', vaultKey), secretOf('w2'));
  assert.ok(sameKdf(kdfOf(storedBox(vaultKeyOf('w1'))), vaultKey.kdf));
  assert.ok(sameKdf(kdfOf(storedBox(vaultKeyOf('w2'))), vaultKey.kdf));
});

test('the CosmosPay credential converges with the wallet that owns it', async () => {
  // Written once, at linking, so nothing else would ever rewrite it: left behind, it would
  // read as "no credential" for the rest of the install and the wallet would show receiving
  // as enabled with nothing behind it.
  await install(['w1'], asLegacy);
  mem.setItem(payKeyOf('w1'), JSON.stringify(await legacyBox('{"keys":{"dev":"k"},"organizationId":"o"}', PWD)));

  const opened = await unlockSession(PWD);
  const vaultKey = await convergeSeals(PWD, opened.vaultKey);
  assert.deepEqual(await getCosmosPay('w1', vaultKey), { keys: { dev: 'k' }, organizationId: 'o' });
});

test('a converged device is left byte for byte alone', async () => {
  // This runs on every unlock, including the ones with nothing to do. Rewriting anyway
  // would re-encrypt every vault on the device at each launch — a new salt, a new IV and a
  // new ciphertext for the same secret, on the one file the user cannot afford to lose.
  await install(['w1', 'w2'], asLegacy);
  const first = await unlockSession(PWD);
  await convergeSeals(PWD, first.vaultKey);
  const before = ['w1', 'w2'].map((id) => mem.getItem(vaultKeyOf(id)));

  const second = await unlockSession(PWD);
  await convergeSeals(PWD, second.vaultKey);
  assert.deepEqual(['w1', 'w2'].map((id) => mem.getItem(vaultKeyOf(id))), before);
});

test('a wrong password rewrites nothing', async () => {
  // It cannot be reached with one — this runs behind a successful unlock — but "cannot be
  // reached" is a property of the caller, and the boxes must survive being asked anyway.
  await install(['w1'], asLegacy);
  const before = mem.getItem(vaultKeyOf('w1'));
  await convergeSeals('not the password', await deriveVaultKey('not the password', newKdfParams()));
  assert.equal(mem.getItem(vaultKeyOf('w1')), before);
  assert.deepEqual(await openVault('w1', (await unlockSession(PWD)).vaultKey), secretOf('w1'));
});

test('a wallet that cannot be re-sealed does not cost the session its own key', async () => {
  // The failure this pass must never produce. `convergeSeals` swallows a per-box fault on
  // purpose — the old seal still opens with the password — but the key it RETURNS is the
  // one the whole session runs on, and `secretOf` reads the active wallet's box for every
  // signature. Handing back a key that box does not match is not a degraded session: every
  // send, swap and payout fails with `VaultKeyMismatchError`, and `getCosmosPay` reports the
  // same failure as "no credential", so receiving reads as unlinked too.
  await install(['w1', 'w2'], asLegacy);
  const opened = await unlockSession(PWD);
  mem.failOn(vaultKeyOf('w1')); // the ACTIVE wallet's write refuses
  try {
    const vaultKey = await convergeSeals(PWD, opened.vaultKey);
    assert.deepEqual(await openVault('w1', vaultKey), secretOf('w1'));
  } finally {
    mem.failOn(null);
  }
});

test('an active wallet that cannot move leaves the other wallets where they are', async () => {
  // Aborting rather than carrying on. Converging w2 while w1 stays behind would split the
  // device: no single key covers both, and the one the session gets is the one that does
  // NOT open the wallet in front of the user. The whole pass runs again on the next unlock.
  await install(['w1', 'w2'], asLegacy);
  const before = mem.getItem(vaultKeyOf('w2'));
  const opened = await unlockSession(PWD);
  mem.failOn(vaultKeyOf('w1'));
  try {
    await convergeSeals(PWD, opened.vaultKey);
  } finally {
    mem.failOn(null);
  }
  assert.equal(mem.getItem(vaultKeyOf('w2')), before);
  // And the next unlock, with storage working again, converges both.
  const retry = await convergeSeals(PWD, (await unlockSession(PWD)).vaultKey);
  assert.deepEqual(await openVault('w1', retry), secretOf('w1'));
  assert.deepEqual(await openVault('w2', retry), secretOf('w2'));
});

/* ------------------------------ using the key ------------------------------ */

test('a wallet added during a session is covered by that session key', async () => {
  // The other half of convergence. A wallet sealed under fresh parameters mid-session would
  // be one the session that created it could not read back.
  await install(['w1'], asLegacy);
  const vaultKey = await convergeSeals(PWD, (await unlockSession(PWD)).vaultKey);

  const entry = await addWallet(
    { secret: 'SBNEW', mnemonic: null },
    { publicKey: 'GNEW', name: 'new', birthdate: '', email: '' },
    vaultKey,
  );
  assert.deepEqual(await openVault(entry.id, vaultKey), { secret: 'SBNEW', mnemonic: null });
});

test('a credential saved with the session key reads back with it', async () => {
  await install(['w1'], asLegacy);
  const vaultKey = await convergeSeals(PWD, (await unlockSession(PWD)).vaultKey);
  await saveCosmosPay('w1', { keys: { dev: 'k1', prod: null }, organizationId: 'org' }, vaultKey);
  assert.deepEqual(await getCosmosPay('w1', vaultKey), { keys: { dev: 'k1', prod: null }, organizationId: 'org' });
});

test('a key for other parameters is refused as such, never as a wrong password', async () => {
  // The distinction the failed-attempt ladder depends on: nobody typed anything here, so
  // counting it as a guess would walk the owner toward a lockout for a state they did not
  // cause. `state/store.ts` maps this to "unlock again", not to "wrong password".
  await install(['w1'], asLegacy);
  const foreign = await deriveVaultKey(PWD, newKdfParams());
  await assert.rejects(() => openVault('w1', foreign), VaultKeyMismatchError);
});

/* ------------------------------ password change ------------------------------ */

test('a password change hands back a key that opens everything, and retires the old one', async () => {
  await install(['w1', 'w2'], asLegacy);
  const old = await convergeSeals(PWD, (await unlockSession(PWD)).vaultKey);

  let reenrolled: string[] = [];
  await changePassword(PWD, NEXT_PWD, {
    reenrolDeviceAuth: async (id) => {
      reenrolled.push(id);
      return true;
    },
  });

  // Nothing is enrolled in this environment, so nothing should have been asked to re-enrol.
  assert.deepEqual(reenrolled, []);
  const next = await unlockSession(NEXT_PWD);
  assert.deepEqual(await openVault('w1', next.vaultKey), secretOf('w1'));
  assert.deepEqual(await openVault('w2', next.vaultKey), secretOf('w2'));
  // One key for the device after the change too — not one per wallet.
  assert.ok(sameKdf(kdfOf(storedBox(vaultKeyOf('w2'))), next.vaultKey.kdf));
  assert.equal(await verifyVaultKey(next.vaultKey), true);
  assert.equal(await verifyVaultKey(old), false, 'the pre-change key must open nothing');
  await assert.rejects(() => unlockSession(PWD), WrongPasswordError);
});
