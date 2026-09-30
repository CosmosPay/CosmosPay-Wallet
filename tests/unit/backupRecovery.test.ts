/**
 * The backup's email-recovery door.
 *
 * What must hold, each for a reason a person would feel:
 *
 *  - either server's half alone says nothing about the key — the whole design is that
 *    neither recovery server can open a backup by itself;
 *  - the recovered key opens the backup, and anything else is refused as NOT a guess —
 *    a wrong password counts toward the lock-out, a stale half from the servers must not;
 *  - adding the door keeps every door the box had (a passkey filed by another device
 *    included), and a password reset replaces only the forgotten password.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { joinKey, newRecoveryKey, splitKey } from '@/lib/backupRecovery';
import {
  addRecoveryDoor,
  BackupRecoveryError,
  backupDoors,
  openBackup,
  resetBackupPassword,
  sealBackup,
} from '@/lib/cloudBackup';
import { WrongPasswordError } from '@/lib/crypto';

const kp = Keypair.random();
const SECRET = { secret: kp.secret(), mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' };
const ADDRESS = kp.publicKey();
const PASSKEY = { id: 'cred-1', secret: new Uint8Array(32).fill(7) };

test('a key splits into two halves that each look like nothing and join back', () => {
  const key = newRecoveryKey();
  const [a, b] = splitKey(key);
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, key);
  assert.notDeepEqual(b, key);
  assert.deepEqual(joinKey(a, b), key);
  // A fresh split of the same key gives different halves: a half is not a function of it.
  assert.notDeepEqual(splitKey(key)[0], a);
  assert.throws(() => joinKey(a, new Uint8Array(16)));
});

test('a box sealed with a recovery door opens with the key, and with nothing else it names', async () => {
  const key = newRecoveryKey();
  const box = await sealBackup(SECRET, { password: 'Correct-Horse-9', recovery: key }, ADDRESS);
  assert.deepEqual(backupDoors(box), { password: true, passkeys: [], recovery: true });

  const opened = await openBackup(box, { recovery: key }, ADDRESS);
  assert.equal(opened.secret, SECRET.secret);
  assert.equal(opened.mnemonic, SECRET.mnemonic);

  // A stale or wrong key is refused as the servers' problem, never as a password guess.
  await assert.rejects(openBackup(box, { recovery: newRecoveryKey() }, ADDRESS), BackupRecoveryError);
});

test('a box without the door refuses the key the same way', async () => {
  const box = await sealBackup(SECRET, 'Correct-Horse-9', ADDRESS);
  assert.equal(backupDoors(box).recovery, false);
  await assert.rejects(openBackup(box, { recovery: newRecoveryKey() }, ADDRESS), BackupRecoveryError);
});

test('adding the door keeps the password and a passkey another device filed', async () => {
  const box = await sealBackup(SECRET, { password: 'Correct-Horse-9', passkey: PASSKEY }, ADDRESS);
  const key = newRecoveryKey();
  const next = await addRecoveryDoor(box, 'Correct-Horse-9', key);
  assert.deepEqual(backupDoors(next), { password: true, passkeys: ['cred-1'], recovery: true });
  assert.equal((await openBackup(next, 'Correct-Horse-9', ADDRESS)).secret, SECRET.secret);
  assert.equal((await openBackup(next, { passkey: PASSKEY }, ADDRESS)).secret, SECRET.secret);
  assert.equal((await openBackup(next, { recovery: key }, ADDRESS)).secret, SECRET.secret);

  // Added twice, it is ONE door: the servers hold the halves of one key.
  const again = await addRecoveryDoor(next, { passkey: PASSKEY }, newRecoveryKey());
  assert.equal(JSON.parse(again).slots.filter((s: { kind: string }) => s.kind === 'recovery').length, 1);
});

test('a password reset replaces only the forgotten password', async () => {
  const key = newRecoveryKey();
  const box = await sealBackup(SECRET, { password: 'Forgotten-Pass-1', passkey: PASSKEY, recovery: key }, ADDRESS);
  const next = await resetBackupPassword(box, key, 'Brand-New-Pass-2');

  assert.equal((await openBackup(next, 'Brand-New-Pass-2', ADDRESS)).secret, SECRET.secret);
  await assert.rejects(openBackup(next, 'Forgotten-Pass-1', ADDRESS), WrongPasswordError);
  // The passkey and the recovery door still work: next time is covered too.
  assert.equal((await openBackup(next, { passkey: PASSKEY }, ADDRESS)).secret, SECRET.secret);
  assert.equal((await openBackup(next, { recovery: key }, ADDRESS)).secret, SECRET.secret);
  assert.deepEqual(backupDoors(next), { password: true, passkeys: ['cred-1'], recovery: true });
});

test('a reset with a key that does not open the box changes nothing', async () => {
  const box = await sealBackup(SECRET, { password: 'Forgotten-Pass-1', recovery: newRecoveryKey() }, ADDRESS);
  await assert.rejects(resetBackupPassword(box, newRecoveryKey(), 'Brand-New-Pass-2'), BackupRecoveryError);
});
