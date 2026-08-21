/**
 * Vault crypto (`lib/crypto`) + the message-signing domain separation
 * (`lib/signMessage`). It does NOT cover `lib/vault.ts` — that one wraps storage and
 * has no unit tests yet; the file was called vault.test.ts, which made "the vault is
 * covered" read as true.
 *
 * The literal string 'Contraseña incorrecta.' is load-bearing: ApprovePopup branches
 * on it to decide whether a failed approval is retryable (wrong password) or terminal
 * (anything else). Reword it there and a retry becomes a hard dapp rejection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, seal, toBase64, fromBase64, WrongPasswordError } from '@/lib/crypto';
import { signMessagePayload, SIGN_MESSAGE_DOMAIN } from '@/lib/signMessage';

test('seal -> open round trips', async () => {
  const secret = JSON.stringify({ secret: 'SABC…', mnemonic: 'a b c' });
  const box = await seal(secret, 'correct horse battery staple');
  assert.equal(box.v, 1);
  assert.notEqual(box.data, secret); // actually encrypted
  assert.equal(await open(box, 'correct horse battery staple'), secret);
});

test('a wrong password throws WrongPasswordError, which is what callers branch on', async () => {
  // Asserted by TYPE. This asserted the exact Spanish string ApprovePopup compared
  // against — pinning a bug in place: the popup decided retryable-vs-terminal with
  // `message !== 'Contraseña incorrecta.'`, so one i18n pass would have turned every
  // mistyped password in the dapp window into a terminal rejection, with this test
  // still green because it pinned the same literal from the other side.
  const box = await seal('payload', 'right');
  await assert.rejects(() => open(box, 'wrong'), (e: unknown) => {
    assert.ok(e instanceof WrongPasswordError);
    return true;
  });
});

test('a corrupted box is NOT reported as a wrong password', async () => {
  // Only the decrypt means "wrong password". `data` used to be base64-decoded inside
  // the try, so a damaged ciphertext threw out of atob, was caught, and came back as
  // WrongPasswordError — and every caller reserves an attempt first, so a corrupted
  // vault walked the owner up the backoff ladder blaming their own password.
  const box = await seal('payload', 'pw');
  await assert.rejects(
    () => open({ ...box, data: 'not base64 !!!' }, 'pw'),
    (e: unknown) => {
      assert.ok(!(e instanceof WrongPasswordError), 'a corrupt box must not count as a guess');
      return true;
    },
  );
});

test('tampered ciphertext is rejected (AES-GCM is authenticated)', async () => {
  const box = await seal('payload', 'pw');
  const bytes = fromBase64(box.data);
  bytes[0] ^= 0xff;
  await assert.rejects(() => open({ ...box, data: toBase64(bytes) }, 'pw'));
});

test('every seal uses a fresh salt and iv', async () => {
  const a = await seal('same', 'pw');
  const b = await seal('same', 'pw');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

test('base64 helpers round trip binary', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
});

test('signMessage digest is domain-separated and 32 bytes', async () => {
  const digest = await signMessagePayload('hello');
  assert.equal(digest.length, 32);
  // Different messages -> different digests.
  assert.notDeepEqual([...digest], [...(await signMessagePayload('hello '))]);
  // Stable for the same input.
  assert.deepEqual([...digest], [...(await signMessagePayload('hello'))]);
});

test('the digest is not the raw message — a 32-byte "message" cannot be a tx hash', async () => {
  // The attack: hand over 32 bytes that ARE a transaction hash and get back a valid
  // transaction signature. Hashing with a domain prefix means the signed value is
  // never the caller's bytes.
  const txHashLike = 'A'.repeat(32);
  const digest = await signMessagePayload(txHashLike);
  assert.notEqual(Buffer.from(digest).toString('binary'), txHashLike);
  assert.ok(SIGN_MESSAGE_DOMAIN.length > 0);
});
