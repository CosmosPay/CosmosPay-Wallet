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
  openBackup,
  sealBackup,
} from '@/lib/cloudBackup';
import { WrongPasswordError } from '@/lib/crypto';
import { BACKUP_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS } from '@/constants/crypto';

const kp = Keypair.random();
const secret = { secret: kp.secret(), mnemonic: 'abandon '.repeat(11) + 'about' };
const PASSWORD = 'Correct-Horse-9';

test('the backup cost sits above the platform’s floor and inside what any device will derive', () => {
  // The dev platform refuses a box under 600,000 rounds (BACKUP_MIN_ITERATIONS there).
  assert.ok(BACKUP_PBKDF2_ITERATIONS >= 600_000);
  assert.ok(BACKUP_PBKDF2_ITERATIONS <= MAX_PBKDF2_ITERATIONS);
});

test('a sealed backup is the box the platform accepts, and opens back to the same wallet', async () => {
  const box = await sealBackup(secret, PASSWORD);
  const parsed = JSON.parse(box) as Record<string, unknown>;
  assert.equal(parsed.v, 2);
  assert.equal(parsed.iter, BACKUP_PBKDF2_ITERATIONS);
  assert.equal(Buffer.from(parsed.iv as string, 'base64').length, 12);
  assert.ok(Buffer.from(parsed.salt as string, 'base64').length >= 16);
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

/* ------------------------------ v3: several doors ------------------------------ */


const passkey = (id = 'cred-A', fill = 7) => ({ id, secret: new Uint8Array(32).fill(fill) });

test('only a bare password seals the v2 box an older server accepts; doors always seal v3', async () => {
  const box = await sealBackup(secret, { password: PASSWORD });
  assert.equal(JSON.parse(box).v, 3);
  assert.equal(JSON.parse(await sealBackup(secret, PASSWORD)).v, 2);
});

test('a passkey-only box opens with that passkey and with nothing else', async () => {
  const box = await sealBackup(secret, { passkey: passkey() });
  const parsed = JSON.parse(box) as { v: number; slots: { kind: string; id?: string; data: string }[] };
  assert.equal(parsed.v, 3);
  assert.deepEqual(parsed.slots.map((s) => s.kind), ['passkey']);
  assert.equal(parsed.slots[0].id, 'cred-A');
  // The door holds a wrapped 32-byte key: 32 bytes plus the 16-byte tag, which is what the
  // community server's isBackupBox requires of every slot.
  assert.equal(Buffer.from(parsed.slots[0].data, 'base64').length, 48);
  assert.equal(box.includes(secret.secret), false);

  assert.deepEqual(await openBackup(box, { passkey: passkey() }, kp.publicKey()), secret);
  assert.deepEqual(backupDoors(box), { password: false, passkeys: ['cred-A'] });

  // Another credential is not a door here; the right id with the wrong secret is not one
  // either. Neither is a guess.
  await assert.rejects(openBackup(box, { passkey: passkey('cred-B') }, kp.publicKey()), BackupPasskeyError);
  await assert.rejects(openBackup(box, { passkey: passkey('cred-A', 9) }, kp.publicKey()), BackupPasskeyError);
  // A typed password against a box with no password door IS a wrong password.
  await assert.rejects(openBackup(box, PASSWORD, kp.publicKey()), WrongPasswordError);
});

test('a box with both doors opens through either, and the password door keeps the backup cost', async () => {
  const box = await sealBackup(secret, { password: PASSWORD, passkey: passkey() });
  const parsed = JSON.parse(box) as { slots: { kind: string; iter?: number; salt?: string }[] };
  const pwd = parsed.slots.find((s) => s.kind === 'password');
  assert.equal(pwd?.iter, BACKUP_PBKDF2_ITERATIONS);
  assert.ok(Buffer.from(pwd?.salt ?? '', 'base64').length >= 16);

  assert.deepEqual(await openBackup(box, PASSWORD, kp.publicKey()), secret);
  assert.deepEqual(await openBackup(box, { passkey: passkey() }, kp.publicKey()), secret);
  await assert.rejects(openBackup(box, 'wrong-password-1', kp.publicKey()), WrongPasswordError);
  assert.deepEqual(backupDoors(box), { password: true, passkeys: ['cred-A'] });
});

test('a v3 box still refuses a genuine box filed under another address', async () => {
  const box = await sealBackup(secret, { passkey: passkey() });
  await assert.rejects(openBackup(box, { passkey: passkey() }, Keypair.random().publicKey()), BackupMismatchError);
});

test('a recovered wallet’s account travels inside a v3 box too', async () => {
  const account = Keypair.random().publicKey();
  const box = await sealBackup(secret, { passkey: passkey() }, account);
  assert.equal(box.includes(account), false);
  assert.deepEqual(await openBackup(box, { passkey: passkey() }, account), { ...secret, account });
});

test('a passkey against a v2 box is refused as a passkey problem, not a wrong password', async () => {
  const box = await sealBackup(secret, PASSWORD);
  await assert.rejects(openBackup(box, { passkey: passkey() }, kp.publicKey()), BackupPasskeyError);
  assert.deepEqual(backupDoors(box), { password: true, passkeys: [] });
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
