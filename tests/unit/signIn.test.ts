/**
 * The wallet's own sign-in (src/lib/signIn.ts): what it signs, how it waits, and where an
 * open handshake survives a closed popup.
 *
 * The two challenges are pinned to the SAME literals the dev platform's own test pins
 * (its walletAuthCore.test.ts). Nothing compiles the two repositories together, so a
 * one-character drift on either side is a sign-in that can never finish — and this pair of
 * tests is the only thing that would say so before a user does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiRequestError } from '@/lib/apiError';
import {
  SignInError,
  backupMessage,
  clearSignInHandshake,
  finishMessage,
  loadSignInHandshake,
  saveSignInHandshake,
  signInErrorKey,
  waitForSignIn,
  type SignInHandshake,
} from '@/lib/signIn';
import { SIGN_IN_POLL_TIMEOUT_MS } from '@/constants/signIn';

test('the finish challenge is byte-identical to the platform’s', () => {
  assert.equal(
    finishMessage(' Ada@Example.com ', 'GABC', '2026-09-19T12:00:00.000Z'),
    'Cosmos Pay Wallet sign-in\nemail: ada@example.com\naccount: GABC\nat: 2026-09-19T12:00:00.000Z',
  );
});

test('the backup challenge covers the box’s SHA-256, as the platform computes it', async () => {
  const box = '{"v":2}';
  assert.equal(
    await backupMessage('GABC', box, '2026-09-19T12:00:00.000Z'),
    `Cosmos Pay Wallet backup\naccount: GABC\nbox: ${createHash('sha256').update(box).digest('hex')}\nat: 2026-09-19T12:00:00.000Z`,
  );
});

test('a stopped sign-in names its reason by key, never by copy', () => {
  assert.equal(signInErrorKey('failed', 'email_unverified'), 'signin.error.emailUnverified');
  assert.equal(signInErrorKey('failed', 'denied'), 'signin.error.denied');
  assert.equal(signInErrorKey('failed', 'provider_unavailable'), 'signin.error.failed');
  assert.equal(signInErrorKey('timeout', null), 'signin.error.timeout');
  assert.equal(signInErrorKey('cancelled', null), 'signin.error.cancelled');
  assert.equal(signInErrorKey('expired', null), 'signin.error.expired');
});

const hs = (over: Partial<SignInHandshake> = {}): SignInHandshake => ({
  state: 'state-123',
  provider: 'google',
  verifier: 'v'.repeat(86),
  startedAt: Date.now(),
  ...over,
});

const noSleep = async () => {};

test('the wait returns once the platform says authorized, and not before', async () => {
  const answers = ['pending', 'pending', 'authorized'];
  let polls = 0;
  await waitForSignIn(hs(), () => false, noSleep, async () => ({ status: answers[polls++] }));
  assert.equal(polls, 3);
});

test('a failed sign-in stops the wait with the platform’s reason', async () => {
  await assert.rejects(
    waitForSignIn(hs(), () => false, noSleep, async () => ({ status: 'failed', error: 'email_unverified' })),
    (e: unknown) => e instanceof SignInError && e.reason === 'failed' && e.detail === 'email_unverified',
  );
});

test('an expired or already-redeemed handshake is expired, not a reason to keep polling', async () => {
  for (const status of ['expired', 'redeemed']) {
    await assert.rejects(
      waitForSignIn(hs(), () => false, noSleep, async () => ({ status })),
      (e: unknown) => e instanceof SignInError && e.reason === 'expired',
    );
  }
});

test('a cancel stops the wait before the next poll', async () => {
  let polls = 0;
  await assert.rejects(
    waitForSignIn(hs(), () => true, noSleep, async () => {
      polls++;
      return { status: 'pending' };
    }),
    (e: unknown) => e instanceof SignInError && e.reason === 'cancelled',
  );
  assert.equal(polls, 0);
});

test('a 429 is waited out; any other error ends the wait', async () => {
  let polls = 0;
  await waitForSignIn(hs(), () => false, noSleep, async () => {
    polls++;
    if (polls === 1) throw new ApiRequestError('u', 429, 'rate_limited', 'slow down');
    return { status: 'authorized' };
  });
  assert.equal(polls, 2);
  await assert.rejects(
    waitForSignIn(hs(), () => false, noSleep, async () => {
      throw new ApiRequestError('u', 500, null, 'boom');
    }),
    /boom/,
  );
});

test('past the deadline the wallet stops on its own', async () => {
  await assert.rejects(
    waitForSignIn(hs({ startedAt: Date.now() - SIGN_IN_POLL_TIMEOUT_MS - 1 }), () => false, noSleep, async () => ({
      status: 'pending',
    })),
    (e: unknown) => e instanceof SignInError && e.reason === 'timeout',
  );
});

test('a handshake survives a closed popup, and a stale one is dropped on read', async () => {
  await saveSignInHandshake(hs());
  assert.equal((await loadSignInHandshake())?.state, 'state-123');
  await saveSignInHandshake(hs({ startedAt: Date.now() - SIGN_IN_POLL_TIMEOUT_MS - 1 }));
  assert.equal(await loadSignInHandshake(), null);
  // …and dropped for good, not merely hidden.
  assert.equal(await loadSignInHandshake(Date.now() - SIGN_IN_POLL_TIMEOUT_MS * 2), null);
  await clearSignInHandshake();
});
