import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSecret,
  isValidPublicKey,
  normalizeMnemonic,
  isValidMnemonic,
  accountFromMnemonic,
  accountFromSecret,
  importAccount,
  createMnemonic,
} from '@/lib/wallet';

const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// A real, checksum-valid keypair (StrKey validates the checksum — all-A strings fail).
const VALID_PUB = 'GCMKX4FTMQ3AEIB7OIV457RZ3E6CAI7OM6SHSOHWXZQA5TZRKR55PD6Z';
const VALID_SECRET = 'SDFOIAZOIPOIM7SE23GJWMGBI2N3RC7SDZJ3KYJOBWJRCIWHZPNDZKZL';

test('public/secret key validity', () => {
  assert.equal(isValidPublicKey(VALID_PUB), true);
  assert.equal(isValidPublicKey('not-a-key'), false);
  assert.equal(isValidPublicKey(''), false);
  assert.equal(isValidSecret(VALID_SECRET), true);
  assert.equal(isValidSecret('S' + 'A'.repeat(55)), false); // wrong checksum/length
  assert.equal(isValidSecret('not-a-secret'), false);
});

test('mnemonic normalization collapses whitespace and lowercases', () => {
  assert.equal(normalizeMnemonic('  ABANDON   abandon abandon '), 'abandon abandon abandon');
  assert.equal(isValidMnemonic(VALID_MNEMONIC), true);
  assert.equal(isValidMnemonic('not a real phrase'), false);
});

test('account derivation is deterministic and SEP-5 compatible', async () => {
  const a = await accountFromMnemonic(VALID_MNEMONIC);
  const b = await accountFromMnemonic(VALID_MNEMONIC);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.secret, b.secret);
  assert.ok(a.publicKey.startsWith('G'));
  assert.ok(a.secret.startsWith('S'));
  // different index -> different account
  const c = await accountFromMnemonic(VALID_MNEMONIC, 1);
  assert.notEqual(a.publicKey, c.publicKey);
});

test('raw secret import round-trips a keypair', () => {
  const acc = accountFromSecret(VALID_SECRET);
  assert.equal(acc.publicKey, VALID_PUB);
  assert.equal(acc.secret, VALID_SECRET);
  assert.throws(() => accountFromSecret('nope'));
});

test('importAccount accepts a phrase or a raw secret', async () => {
  const phrase = await importAccount(VALID_MNEMONIC);
  assert.ok(phrase.mnemonic);
  assert.ok(phrase.account.publicKey.startsWith('G'));
  const raw = await importAccount(VALID_SECRET);
  assert.equal(raw.mnemonic, null);
  assert.equal(raw.account.publicKey, VALID_PUB);
  await assert.rejects(() => importAccount(''));
  await assert.rejects(() => importAccount('gibberish'));
});

test('createMnemonic produces a valid 12-word phrase', () => {
  const m = createMnemonic();
  assert.equal(m.split(' ').length, 12);
  assert.equal(isValidMnemonic(m), true);
});
