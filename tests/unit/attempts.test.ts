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
  beginAttempt,
  blockSeconds,
  noteAttemptFailure,
  noteAttemptSuccess,
  parseAttempts,
  recordFailure,
  releaseAttempt,
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

/* --------------------------- the concurrent case --------------------------- */

/**
 * The property the serial tests above cannot see, and the one the ladder was losing.
 *
 * `attemptBlockMs` + `noteAttemptFailure` is check → derive → write, and storage is async,
 * so every attempt launched inside one PBKDF2 window read the same pre-increment record
 * and wrote the same `fails + 1`. The ladder counted ROUNDS, not GUESSES: holding Enter
 * down on the unlock screen launched roughly eight derivations per window, and CPU
 * contention lengthened the window, which admitted more. `beginAttempt` closes it by
 * doing the check and the reservation as one step on a single chain.
 */
test('concurrent attempts each cost a rung — the ladder counts guesses, not rounds', async () => {
  await noteAttemptSuccess();
  const now = 3_000_000;

  // Ten attempts fired without awaiting each other, exactly as a held-down Enter key does.
  const waits = await Promise.all(Array.from({ length: 10 }, () => beginAttempt(now)));

  const allowed = waits.filter((ms) => ms === 0).length;
  assert.equal(allowed, 4, 'only the three free guesses plus the one that arms the ladder may pass');
  assert.ok(
    waits.filter((ms) => ms > 0).length === 6,
    'every attempt past the fourth must be told to wait',
  );
});

test('a reservation is not released by a later attempt failing to get one', async () => {
  await noteAttemptSuccess();
  const now = 4_000_000;
  for (let i = 0; i < 4; i++) assert.equal(await beginAttempt(now), 0, `attempt ${i + 1} is free`);
  // Blocked now — and being refused must not reset the count, or a caller could clear its
  // own backoff simply by asking again.
  assert.equal(await beginAttempt(now), 1_000);
  assert.equal(await beginAttempt(now), 1_000, 'still blocked, still counted');
  // Past the rung, the next one is allowed and arms the one after it.
  assert.equal(await beginAttempt(now + 1_001), 0);
  assert.equal(await beginAttempt(now + 1_001), 5_000, 'the fifth failure arms the 5s rung');
});

test('a correct password clears a reservation that was taken up front', async () => {
  await noteAttemptSuccess();
  const now = 5_000_000;
  assert.equal(await beginAttempt(now), 0);
  await noteAttemptSuccess(); // the guess was right
  assert.equal(await attemptBlockMs(now), 0);
  // ...and the count really restarted: four more must still be free.
  for (let i = 0; i < 4; i++) assert.equal(await beginAttempt(now), 0, `attempt ${i + 1}`);
});

test('a released reservation gives back exactly one guess, not the whole history', async () => {
  await noteAttemptSuccess();
  const now = 6_000_000;
  for (let i = 0; i < 3; i++) await beginAttempt(now); // three real guesses, all free

  // The fourth attempt reserves and then turns out never to have been a guess — a missing
  // vault blob, a storage fault. Giving it back must not wipe the three that were real:
  // a caller could otherwise clear an accumulated backoff by provoking a non-password
  // failure instead of guessing.
  await beginAttempt(now);
  await releaseAttempt();

  assert.equal(await attemptBlockMs(now), 0, 'three failures still do not block');
  await beginAttempt(now); // this is failure #4 again
  assert.equal(await attemptBlockMs(now), 1_000, 'and it arms the first rung, as it should');
});

test('releasing more than was taken cannot go negative', async () => {
  await noteAttemptSuccess();
  await releaseAttempt();
  await releaseAttempt();
  assert.equal(await attemptBlockMs(), 0);
  // ...and the ladder still starts from the top afterwards.
  const now = 7_000_000;
  for (let i = 0; i < 4; i++) assert.equal(await beginAttempt(now), 0, `attempt ${i + 1} is free`);
  assert.equal(await beginAttempt(now), 1_000);
});
