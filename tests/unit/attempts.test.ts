/**
 * The wrong-password backoff (src/lib/attempts.ts).
 *
 * Worth a test rather than a read-through because both directions are bugs with teeth: too
 * lenient and `revealBackup` answers a guessing loop with the seed phrase, too strict and
 * the owner of the wallet is locked out of their own money by a typo. The ladder's shape
 * IS the security property, so it is asserted, not just exercised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTEMPT_DELAY_MS,
  NO_ATTEMPTS,
  attemptBlockMs,
  blockSeconds,
  noteAttemptFailure,
  noteAttemptSuccess,
  parseAttempts,
  recordFailure,
  remainingBlockMs,
} from '@/lib/attempts';

/** Walk N consecutive failures from a clean slate, all at the same instant. */
const afterFailures = (n: number, now = 1_000_000) => {
  let rec = NO_ATTEMPTS;
  for (let i = 0; i < n; i++) rec = recordFailure(rec, now);
  return rec;
};

test('the first three wrong guesses are free — a typo is not an attack', () => {
  const now = 1_000_000;
  for (const n of [1, 2, 3]) {
    assert.equal(remainingBlockMs(afterFailures(n, now), now), 0, `${n} failures must not block`);
  }
});

test('the fourth starts the ladder, and it climbs', () => {
  const now = 1_000_000;
  const delays = [4, 5, 6, 7].map((n) => remainingBlockMs(afterFailures(n, now), now));
  assert.deepEqual(delays, [1_000, 5_000, 15_000, 60_000]);
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] > delays[i - 1], 'each rung must be longer than the last');
  }
});

test('the ladder CAPS — an unbounded one is a wallet the owner can destroy by mistyping', () => {
  const now = 1_000_000;
  for (const n of [8, 20, 5_000]) {
    assert.equal(remainingBlockMs(afterFailures(n, now), now), MAX_ATTEMPT_DELAY_MS, `${n} failures`);
  }
  assert.equal(MAX_ATTEMPT_DELAY_MS, 300_000, 'five minutes: long enough to matter, short enough to survive');
});

test('the block expires on its own — waiting is what clears it', () => {
  const now = 1_000_000;
  const rec = afterFailures(5, now); // 5s
  assert.equal(remainingBlockMs(rec, now), 5_000);
  assert.equal(remainingBlockMs(rec, now + 4_999), 1);
  assert.equal(remainingBlockMs(rec, now + 5_000), 0);
  assert.equal(remainingBlockMs(rec, now + 60_000), 0);
});

test('a clock that jumped backwards cannot brick unlock until the date catches up', () => {
  // blockedUntil a year out — only reachable if the device clock moved back after it was
  // written. Capping the answer at one full delay keeps that recoverable.
  const rec = { fails: 4, blockedUntil: 1_000_000 + 365 * 24 * 3_600_000 };
  assert.equal(remainingBlockMs(rec, 1_000_000), MAX_ATTEMPT_DELAY_MS);
});

test('seconds shown always round UP, so "wait 1s" never means "wait 0s"', () => {
  assert.equal(blockSeconds(1), 1);
  assert.equal(blockSeconds(999), 1);
  assert.equal(blockSeconds(1_000), 1);
  assert.equal(blockSeconds(1_001), 2);
});

test('a corrupt record reads as "no failures" — this guards usability, not integrity', () => {
  // Deliberately the forgiving direction: an attacker who can rewrite app storage can also
  // delete the record, so treating corruption as a lockout would only punish the owner.
  for (const raw of [null, '', '{nope', '[]', '{"fails":"lots"}', '{"fails":-3}', '{"fails":2}']) {
    const rec = parseAttempts(raw);
    assert.equal(remainingBlockMs(rec, Date.now()), 0, `${raw} must not block`);
  }
});

test('a valid record survives the round trip', () => {
  const rec = { fails: 5, blockedUntil: 1_234_567 };
  assert.deepEqual(parseAttempts(JSON.stringify(rec)), rec);
});

/* ----------------------------- persisted behaviour ---------------------------- */

test('failures persist and accumulate; a success wipes the history clean', async () => {
  await noteAttemptSuccess(); // start from a known-clean slate
  assert.equal(await attemptBlockMs(), 0);

  const now = 2_000_000;
  for (let i = 0; i < 4; i++) await noteAttemptFailure(now);
  assert.equal(await attemptBlockMs(now), 1_000, 'four failures arm the first rung');

  // Cleared, not decremented: someone who knows the password has answered the question the
  // counter was asking, and a residue would escalate an unrelated attempt tomorrow.
  await noteAttemptSuccess();
  assert.equal(await attemptBlockMs(now), 0);
  await noteAttemptFailure(now);
  assert.equal(await attemptBlockMs(now), 0, 'the count restarted, so this is failure #1');
});
