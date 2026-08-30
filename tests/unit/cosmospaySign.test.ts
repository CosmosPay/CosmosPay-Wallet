/**
 * The two account-proof signatures in `src/lib/cosmospay.ts`, checked the way the server
 * checks them: verify against the public key.
 *
 * stellar-sdk 17 returns a plain `Uint8Array` from `Keypair.sign()` instead of a `Buffer`,
 * and `Uint8Array#toString()` IGNORES its argument — `sig.toString('base64')` returns
 * `'37,180,27,…'`, a list of decimals, with no error thrown. The bump caught it only
 * because v17 also dropped the parameter from the type, so the compiler said "Expected 0
 * arguments, but got 1". A cast, or a future SDK that keeps the parameter, puts the bug
 * back with the whole suite green: these two functions had no test of their own, and a
 * registration the server rejects for an unreadable signature looks like a network error
 * to the user.
 *
 * So the assertions below are on the bytes, not on the call: 64 bytes, and a signature
 * ed25519 accepts. That holds under any SDK version and any return type.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { signLinkMessage, signRegistrationMessage } from '@/lib/cosmospay';

/* The same throwaway fixture key tests/unit/txGuard.test.ts signs with. */
const SECRET = 'SDJHRQF4GCMIIKAAAQ6IHY42X73FQFLHUULAPSKKD4DFDM7UXWWCRHBE';
const kp = Keypair.fromSecret(SECRET);
const ADDR = kp.publicKey();

/** What the server does with the base64 it receives. */
const verifies = (message: string, sigB64: string) =>
  kp.verify(Buffer.from(message, 'utf8'), Buffer.from(sigB64, 'base64'));

test('signRegistrationMessage returns base64 the server can verify', () => {
  /* The message is built from the normalised email — trimmed and lowercased. */
  const sig = signRegistrationMessage(SECRET, '  Ada@Example.COM ', ADDR, 'n0nce');
  assert.doesNotMatch(sig, /^\d+,\d+,/, 'a Uint8Array stringified itself instead of encoding');
  assert.equal(Buffer.from(sig, 'base64').length, 64, 'an ed25519 signature is 64 bytes');
  assert.ok(
    verifies(
      `Cosmos Pay Wallet account registration\nemail: ada@example.com\naccount: ${ADDR}\nnonce: n0nce`,
      sig,
    ),
  );
});

test('signLinkMessage returns base64 the server can verify', () => {
  const sig = signLinkMessage(SECRET, '  Ada@Example.COM ', ADDR, 'n0nce');
  assert.doesNotMatch(sig, /^\d+,\d+,/, 'a Uint8Array stringified itself instead of encoding');
  assert.equal(Buffer.from(sig, 'base64').length, 64, 'an ed25519 signature is 64 bytes');
  assert.ok(
    verifies(
      `Cosmos Pay Wallet account link\nemail: ada@example.com\naccount: ${ADDR}\nnonce: n0nce`,
      sig,
    ),
  );
});

/* The two prefixes exist so a signature for one flow cannot be replayed in the other —
   which only means anything if the signed bytes actually differ. */
test('registration and link signatures over the same inputs differ', () => {
  assert.notEqual(
    signRegistrationMessage(SECRET, 'ada@example.com', ADDR, 'n0nce'),
    signLinkMessage(SECRET, 'ada@example.com', ADDR, 'n0nce'),
  );
});
