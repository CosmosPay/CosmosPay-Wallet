/**
 * The cloud backup (src/lib/cloudBackup.ts): the seed, sealed here under the person's
 * password, kept by a server that cannot open it.
 *
 * What is asserted is what the server's own validator relies on (the box shape and its
 * PBKDF2 cost) and the two refusals that protect the person on restore: a wrong password is
 * a `WrongPasswordError` — the only failure the attempt ladder counts — and a genuine box
 * that opens to a DIFFERENT wallet than it was filed as is refused, not restored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import {
  BackupMismatchError,
  BackupPasskeyError,
  BackupUnreadableError,
  backupDoors,
  backupNeedsUpgrade,
  openBackup,
  sealBackup,
} from '@/lib/cloudBackup';
import { WrongPasswordError } from '@/lib/crypto';
import {
  BACKUP_ARGON2,
  BACKUP_PBKDF2_ITERATIONS,
  MAX_ARGON2_MEMORY_KIB,
  MAX_ARGON2_PASSES,
  MAX_PBKDF2_ITERATIONS,
  SALT_BYTES,
} from '@/constants/crypto';
import { derivePasswordKey, newRandomKey, sealBytes, sealForBackup, toBase64 } from '@/lib/crypto';

const kp = Keypair.random();
const secret = { secret: kp.secret(), mnemonic: 'abandon '.repeat(11) + 'about' };
const PASSWORD = 'Correct-Horse-9';

test('the backup cost sits above the server’s floor and inside what any device will derive', () => {
  // The community server refuses a v4 password door under 19 MiB or 2 passes
  // (BACKUP_ARGON2_MIN_* there), and a v2/v3 one under 600,000 PBKDF2 rounds.
  assert.ok(BACKUP_ARGON2.m >= 19_456 && BACKUP_ARGON2.t >= 2 && BACKUP_ARGON2.p >= 1);
  assert.ok(BACKUP_ARGON2.m <= MAX_ARGON2_MEMORY_KIB && BACKUP_ARGON2.t <= MAX_ARGON2_PASSES);
  assert.ok(BACKUP_PBKDF2_ITERATIONS >= 600_000);
  assert.ok(BACKUP_PBKDF2_ITERATIONS <= MAX_PBKDF2_ITERATIONS);
});

test('a sealed backup is the box the platform accepts, and opens back to the same wallet', async () => {
  const box = await sealBackup(secret, PASSWORD);
  const parsed = JSON.parse(box) as { v: number; iv: string; slots: Record<string, unknown>[] };
  assert.equal(parsed.v, 4);
  assert.equal(Buffer.from(parsed.iv, 'base64').length, 12);
  const [door] = parsed.slots;
  assert.equal(parsed.slots.length, 1);
  assert.deepEqual(
    { kind: door.kind, kdf: door.kdf, m: door.m, t: door.t, p: door.p },
    { kind: 'password', kdf: 'argon2id', ...BACKUP_ARGON2 },
  );
  assert.ok(Buffer.from(door.salt as string, 'base64').length >= 16);
  assert.equal('iter' in door, false);
  // Nothing readable leaves the device.
  assert.equal(box.includes(secret.secret), false);
  assert.equal(box.includes('abandon'), false);

  assert.deepEqual(await openBackup(box, PASSWORD, kp.publicKey()), secret);

  // A wrong password is a guess, and says so by type.
  await assert.rejects(openBackup(box, 'wrong-password-1', kp.publicKey()), WrongPasswordError);
  // The right password on a box filed under another address is refused, not restored.
  await assert.rejects(openBackup(box, PASSWORD, Keypair.random().publicKey()), BackupMismatchError);
});

test('what is not a box is unreadable, never a wrong password', async () => {
  for (const junk of ['', 'not json', '[]', '{"v":1}', JSON.stringify({ v: 2, salt: 1, iv: 'a', data: 'b' })]) {
    await assert.rejects(openBackup(junk, PASSWORD, kp.publicKey()), BackupUnreadableError);
  }
});

/* ------------------------------ slot boxes: several doors ------------------------------ */


const passkey = (id = 'cred-A', fill = 7) => ({ id, secret: new Uint8Array(32).fill(fill) });

/** A v3 box as the wallet wrote it before Argon2id: slots, with a PBKDF2 password door. */
async function legacyV3(doors: { password?: string; passkey?: { id: string; secret: Uint8Array } }) {
  const dataKey = newRandomKey();
  const slots: Record<string, unknown>[] = [];
  if (doors.password) {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
    const key = await derivePasswordKey(doors.password, { salt, iter: BACKUP_PBKDF2_ITERATIONS });
    slots.push({ kind: 'password', salt, iter: BACKUP_PBKDF2_ITERATIONS, ...(await sealBytes(dataKey, key)) });
  }
  if (doors.passkey) slots.push({ kind: 'passkey', id: doors.passkey.id, ...(await sealBytes(dataKey, doors.passkey.secret)) });
  return JSON.stringify({ v: 3, ...(await sealBytes(new TextEncoder().encode(JSON.stringify(secret)), dataKey)), slots });
}

test('every seal is v4, whatever the doors', async () => {
  assert.equal(JSON.parse(await sealBackup(secret, PASSWORD)).v, 4);
  assert.equal(JSON.parse(await sealBackup(secret, { password: PASSWORD })).v, 4);
  assert.equal(JSON.parse(await sealBackup(secret, { passkey: passkey() })).v, 4);
});

/* The server holds boxes written before Argon2id: they must keep opening, and a restore
   upgrades the ones it can re-seal without losing a door. */
test('v2 and v3 boxes still open, and only password-only ones are due an upgrade', async () => {
  const v2 = JSON.stringify(await sealForBackup(JSON.stringify(secret), PASSWORD));
  assert.deepEqual(await openBackup(v2, PASSWORD, kp.publicKey()), secret);
  assert.equal(backupNeedsUpgrade(v2), true);

  const v3 = await legacyV3({ password: PASSWORD });
  assert.deepEqual(await openBackup(v3, PASSWORD, kp.publicKey()), secret);
  assert.equal(backupNeedsUpgrade(v3), true);

  // A passkey door cannot be reproduced from the password, so that box is left alone.
  const v3pk = await legacyV3({ password: PASSWORD, passkey: passkey() });
  assert.deepEqual(await openBackup(v3pk, { passkey: passkey() }, kp.publicKey()), secret);
  assert.equal(backupNeedsUpgrade(v3pk), false);

  assert.equal(backupNeedsUpgrade(await sealBackup(secret, PASSWORD)), false);
});

test('a v4 door with parameters past the ceiling is refused, not attempted', async () => {
  const box = JSON.parse(await sealBackup(secret, PASSWORD));
  box.slots[0].m = MAX_ARGON2_MEMORY_KIB * 4;
  await assert.rejects(openBackup(JSON.stringify(box), PASSWORD, kp.publicKey()), /Argon2/);
});

test('a passkey-only box opens with that passkey and with nothing else', async () => {
  const box = await sealBackup(secret, { passkey: passkey() });
  const parsed = JSON.parse(box) as { v: number; slots: { kind: string; id?: string; data: string }[] };
  assert.equal(parsed.v, 4);
  assert.deepEqual(parsed.slots.map((s) => s.kind), ['passkey']);
  assert.equal(parsed.slots[0].id, 'cred-A');
  // The door holds a wrapped 32-byte key: 32 bytes plus the 16-byte tag, which is what the
  // community server's isBackupBox requires of every slot.
  assert.equal(Buffer.from(parsed.slots[0].data, 'base64').length, 48);
  assert.equal(box.includes(secret.secret), false);

  assert.deepEqual(await openBackup(box, { passkey: passkey() }, kp.publicKey()), secret);
  assert.deepEqual(backupDoors(box), { password: false, passkeys: ['cred-A'], recovery: false });

  // Another credential is not a door here; the right id with the wrong secret is not one
  // either. Neither is a guess.
  await assert.rejects(openBackup(box, { passkey: passkey('cred-B') }, kp.publicKey()), BackupPasskeyError);
  await assert.rejects(openBackup(box, { passkey: passkey('cred-A', 9) }, kp.publicKey()), BackupPasskeyError);
  // A typed password against a box with no password door IS a wrong password.
  await assert.rejects(openBackup(box, PASSWORD, kp.publicKey()), WrongPasswordError);
});

test('a box with both doors opens through either, and the password door keeps the backup cost', async () => {
  const box = await sealBackup(secret, { password: PASSWORD, passkey: passkey() });
  const parsed = JSON.parse(box) as { slots: { kind: string; kdf?: string; m?: number; t?: number; salt?: string }[] };
  const pwd = parsed.slots.find((s) => s.kind === 'password');
  assert.deepEqual({ kdf: pwd?.kdf, m: pwd?.m, t: pwd?.t }, { kdf: 'argon2id', m: BACKUP_ARGON2.m, t: BACKUP_ARGON2.t });
  assert.ok(Buffer.from(pwd?.salt ?? '', 'base64').length >= 16);

  assert.deepEqual(await openBackup(box, PASSWORD, kp.publicKey()), secret);
  assert.deepEqual(await openBackup(box, { passkey: passkey() }, kp.publicKey()), secret);
  await assert.rejects(openBackup(box, 'wrong-password-1', kp.publicKey()), WrongPasswordError);
  assert.deepEqual(backupDoors(box), { password: true, passkeys: ['cred-A'], recovery: false });
});

test('a slot box still refuses a genuine box filed under another address', async () => {
  const box = await sealBackup(secret, { passkey: passkey() });
  await assert.rejects(openBackup(box, { passkey: passkey() }, Keypair.random().publicKey()), BackupMismatchError);
});

test('a recovered wallet’s account travels inside a v4 box too', async () => {
  const account = Keypair.random().publicKey();
  const box = await sealBackup(secret, { passkey: passkey() }, account);
  assert.equal(box.includes(account), false);
  assert.deepEqual(await openBackup(box, { passkey: passkey() }, account), { ...secret, account });
});

/* What `recoverWallet` seals after a SEP-30 re-key: the new key is no longer the account.
   The server files the box under the ACCOUNT, and restore checks against that — so a box
   sealed without the account is one the recovered wallet can never open again. */
test('a recovered wallet opens under its account only when sealed with it', async () => {
  const account = Keypair.random().publicKey();
  const withAccount = await sealBackup(secret, PASSWORD, account);
  assert.deepEqual(await openBackup(withAccount, PASSWORD, account), { ...secret, account });

  const without = await sealBackup(secret, PASSWORD);
  await assert.rejects(openBackup(without, PASSWORD, account), BackupMismatchError);
});

test('a passkey against a v2 box is refused as a passkey problem, not a wrong password', async () => {
  const box = await sealBackup(secret, PASSWORD);
  await assert.rejects(openBackup(box, { passkey: passkey() }, kp.publicKey()), BackupPasskeyError);
  assert.deepEqual(backupDoors(box), { password: true, passkeys: [], recovery: false });
});

test('a v3 box with no doors, or a door of a kind this build does not know, is unreadable', async () => {
  const ok = JSON.parse(await sealBackup(secret, { passkey: passkey() })) as Record<string, unknown>;
  for (const slots of [[], [{ kind: 'pin', iv: 'AAAA', data: 'AAAA' }], 'passkey']) {
    await assert.rejects(openBackup(JSON.stringify({ ...ok, slots }), PASSWORD, kp.publicKey()), BackupUnreadableError);
  }
});

test('sealing with no door at all is a programming error, not an empty box', async () => {
  await assert.rejects(sealBackup(secret, {}), /at least one door/);
});
