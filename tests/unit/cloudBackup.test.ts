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
import { BackupMismatchError, BackupUnreadableError, openBackup, sealBackup } from '@/lib/cloudBackup';
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
