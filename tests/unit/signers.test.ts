/**
 * The manual signature screen signs another account's transaction only when this account's key
 * alone controls that account (a sub-account, such as a Cosmos Pay private sub-account), and only
 * an envelope that authorizes that account and nothing else. Being listed as a signer is not
 * enough: anyone can add any key to their own account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { controlledBy, foreignEnvelopeProblem } from '@/lib/signers';

const me = Keypair.random().publicKey();
const sub = Keypair.random().publicKey();
const other = Keypair.random().publicKey();
const ONE = { low_threshold: 1, med_threshold: 1, high_threshold: 1 };
const ed = (key: string, weight: number) => ({ key, weight, type: 'ed25519_public_key' });

test('a sub-account whose only signer is this key: controlled', () => {
  // Its own key at weight 0, this account at 1: what a Cosmos Pay sub-account looks like.
  assert.equal(controlledBy([ed(me, 1), ed(sub, 0)], ONE, me), true);
});

test('an account that kept another signer, or its own key, is not this key\'s', () => {
  // Someone who added this key to their account but kept their own: still theirs.
  assert.equal(controlledBy([ed(me, 1), ed(sub, 1)], ONE, me), false);
  assert.equal(controlledBy([ed(me, 1), ed(other, 1), ed(sub, 0)], ONE, me), false);
  assert.equal(controlledBy([ed(sub, 1)], ONE, me), false);
  assert.equal(controlledBy([], ONE, me), false);
});

test('this key must meet every threshold, and be an ed25519 key', () => {
  assert.equal(controlledBy([ed(me, 1), ed(sub, 0)], { low_threshold: 1, med_threshold: 2, high_threshold: 2 }, me), false);
  assert.equal(controlledBy([ed(me, 2), ed(sub, 0)], { low_threshold: 1, med_threshold: 2, high_threshold: 2 }, me), true);
  assert.equal(controlledBy([{ key: me, weight: 1, type: 'sha256_hash' }, ed(sub, 0)], ONE, me), false);
});

test("another account's envelope may authorize that account only", () => {
  const op = (source: string | null) => ({ source }) as never;
  // Operations without a source of their own (the transaction's) or with the sub-account's: fine.
  assert.equal(foreignEnvelopeProblem({ source: sub, operations: [op(null), op(sub)], feeBumpSource: null }), null);
  // One operation sourced at this account would spend from it under a prompt naming the sub-account.
  assert.equal(foreignEnvelopeProblem({ source: sub, operations: [op(null), op(me)], feeBumpSource: null }), 'sign.foreignOps');
  assert.equal(foreignEnvelopeProblem({ source: sub, operations: [op(other)], feeBumpSource: null }), 'sign.foreignOps');
  // A fee-bump wrapper is refused on this path.
  assert.equal(foreignEnvelopeProblem({ source: sub, operations: [op(null)], feeBumpSource: me }), 'sign.foreignOps');
});
