/**
 * The manual signature screen signs another account's transaction only when this account's key
 * is one of that account's signers (a sub-account it controls, such as a Cosmos Pay private
 * sub-account). Anything else stays refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { signsFor } from '@/lib/signers';

const me = Keypair.random().publicKey();
const sub = Keypair.random().publicKey();

test('a sub-account whose only signer is this key: signs for it', () => {
  // Its own key at weight 0, this account at 1: what a Cosmos Pay sub-account looks like.
  assert.equal(signsFor([{ key: me, weight: 1, type: 'ed25519_public_key' }, { key: sub, weight: 0, type: 'ed25519_public_key' }], me), true);
});

test('an account that does not list this key, or lists it at weight 0: refused', () => {
  assert.equal(signsFor([{ key: sub, weight: 1, type: 'ed25519_public_key' }], me), false);
  assert.equal(signsFor([{ key: me, weight: 0, type: 'ed25519_public_key' }, { key: sub, weight: 1, type: 'ed25519_public_key' }], me), false);
  assert.equal(signsFor([], me), false);
});

test('only an ed25519 signer counts, never a hash or pre-auth signer with the same text', () => {
  assert.equal(signsFor([{ key: me, weight: 1, type: 'sha256_hash' }], me), false);
  assert.equal(signsFor([{ key: me, weight: 1, type: 'preauth_tx' }], me), false);
});
