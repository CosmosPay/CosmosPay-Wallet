/**
 * Failed-password backoff.
 *
 * Every path that turns a typed string into the seed — `unlock`, the signing gate's
 * `checkPassword`, and `revealBackup`, which hands back the mnemonic — decrypts the vault
 * to find out whether the password was right. Until this module existed, the only cost of
 * a wrong guess was one PBKDF2 derivation: 210,000 iterations is roughly 200-400ms on a
 * phone, so an unattended-but-locked wallet accepted on the order of ten thousand guesses
 * an hour, and `revealBackup` in particular would answer every one of them with the seed
 * phrase on the first hit.
 *
 * This does NOT protect the vault blob itself. Someone holding the file attacks it offline
 * where no app-side counter exists — that is what the PBKDF2 cost and the password's own
 * entropy are for. What it protects is the case that actually happens: a person with the
 * phone in their hand, typing.
 *
 * All of it lives here, persistence included, so `node:test` can reach the decision rather
 * than only the arithmetic — the store hook is not importable from there. The record is
 * persisted rather than held in React state because the MV3 popup is torn down every time
 * the window loses focus, and a counter that resets on blur is not a counter.
 */
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

/** Global, not per wallet: one app password seals every wallet on the device. */
const ATTEMPTS_KEY = 'cosmos.pwdAttempts';

/**
 * Delay after the Nth consecutive failure, INDEXED BY N. Index 0 is unused padding, so
 * `LADDER_MS[3]` is the wait imposed by the third wrong guess — read it that way or the
 * "first three are free" rule silently becomes "first two".
 *
 * The first three are free: a typo, a wrong keyboard layout, and a stale password-manager
 * entry are all one honest user, and punishing them teaches nothing. It climbs steeply
 * after that and caps at five minutes — long enough to make manual guessing pointless,
 * short enough that a legitimate user who fat-fingered four times is not locked out of
 * their own money for the evening. The cap matters: an unbounded ladder is a wallet the
 * owner can permanently destroy by mistyping.
 */
const LADDER_MS = [0, 0, 0, 0, 1_000, 5_000, 15_000, 60_000, 300_000] as const;

export const MAX_ATTEMPT_DELAY_MS = LADDER_MS[LADDER_MS.length - 1];

export interface AttemptRecord {
  /** Consecutive failures. Reset to 0 by a success, never decremented by time. */
  fails: number;
  /** Epoch ms before which the next attempt is refused. */
  blockedUntil: number;
}

export const NO_ATTEMPTS: AttemptRecord = { fails: 0, blockedUntil: 0 };

/**
 * Read a persisted record.
 *
 * Anything unparseable reads as "no failures". That is the FORGIVING direction, and it is
 * deliberate: this is a usability guard, not an integrity control. An attacker who can
 * rewrite the app's own storage can also just delete the record, so treating corruption as
 * a lockout would only ever punish the owner of a wallet whose storage got scrambled.
 */
export function parseAttempts(raw: string | null): AttemptRecord {
  if (!raw) return NO_ATTEMPTS;
  try {
    const parsed = JSON.parse(raw) as Partial<AttemptRecord>;
    const fails = Number(parsed?.fails);
    const blockedUntil = Number(parsed?.blockedUntil);
    if (!Number.isFinite(fails) || !Number.isFinite(blockedUntil) || fails < 0) return NO_ATTEMPTS;
    return { fails: Math.floor(fails), blockedUntil };
  } catch {
    return NO_ATTEMPTS;
  }
}

/** How long the caller must wait, in ms. 0 means "go ahead". */
export function remainingBlockMs(rec: AttemptRecord, now: number): number {
  // A `blockedUntil` far in the future can only come from a clock that has since moved
  // backwards (a timezone fix, an NTP correction, a user changing the date). Capping the
  // answer at the LONGEST rung — not at the rung this record earned — stops that from
  // bricking unlock until the date catches up. The cap is deliberately generous in the
  // other direction too: `blockedUntil` is wall-clock, so someone holding the phone can
  // clear any block from the Settings app without a password. That is accepted, for the
  // reason in the header: this bounds a person typing, not an attacker with the file.
  return Math.max(0, Math.min(rec.blockedUntil - now, MAX_ATTEMPT_DELAY_MS));
}

/** Whole seconds to show the user — always rounds UP, so "wait 1s" never means "wait 0s". */
export function blockSeconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

/** Record a wrong password and arm the next delay. */
export function recordFailure(rec: AttemptRecord, now: number): AttemptRecord {
  const fails = rec.fails + 1;
  const delay = LADDER_MS[Math.min(fails, LADDER_MS.length - 1)];
  return { fails, blockedUntil: now + delay };
}

/* -------------------------------- persistence -------------------------------- */

/**
 * Every read-modify-write below runs on one chain.
 *
 * Storage is async — an IPC round trip to the Rust side on a phone — so `read; modify; write`
 * is a window, not a step. Without this, N attempts launched inside one window all read
 * the same pre-increment record and all write `fails = N+1`: the ladder counted ROUNDS
 * instead of GUESSES, and nothing in the app serialised them. Enter with key auto-repeat
 * held down on the unlock screen and ~8 derivations start per window; CPU contention makes
 * the window longer, which admits more, with no ceiling in code.
 *
 * `then(fn, fn)` on purpose: a rejected link must not stall every later attempt behind it.
 * The chain is a module-level singleton because the counter is one global record; two
 * documents of the same extension (popup, side panel, approval window) still race, which is
 * why `beginAttempt` also commits BEFORE the derivation rather than after it.
 */
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * How long the next password attempt must wait, in ms. 0 means "go ahead".
 *
 * Read-only, so it does NOT reserve an attempt: use it to word a message or to decide
 * whether to raise a prompt at all. Anything that is about to derive a key must call
 * `beginAttempt` instead, which is the same check and the reservation in one step.
 */
export async function attemptBlockMs(now = Date.now()): Promise<number> {
  return serial(async () => remainingBlockMs(parseAttempts(await storageGet(ATTEMPTS_KEY)), now));
}

/**
 * Claim the right to make one attempt. Returns the wait in ms; 0 means "go ahead".
 *
 * COUNTS THE FAILURE UP FRONT, under the chain, and leaves it counted — `noteAttemptSuccess`
 * is what clears it. Checking first and counting after the derivation is what made the
 * ladder defeatable: the ~250ms of PBKDF2 sat between the check and the write, so every
 * attempt launched inside it saw a clean record. Reserving before deriving also fails
 * closed on a kill: a process that dies mid-derivation leaves the guess counted, which is
 * the right direction for a counter whose whole job is to make guesses expensive.
 *
 * The ladder's shape is unchanged. The first three still cost nothing: the fourth call
 * reads `fails: 3`, is not blocked, and arms the 1s rung for the fifth.
 */
export async function beginAttempt(now = Date.now()): Promise<number> {
  return serial(async () => {
    const rec = parseAttempts(await storageGet(ATTEMPTS_KEY));
    const blocked = remainingBlockMs(rec, now);
    if (blocked > 0) return blocked;
    await storageSet(ATTEMPTS_KEY, JSON.stringify(recordFailure(rec, now)));
    return 0;
  });
}

/**
 * Give back a reservation `beginAttempt` took for an attempt that never happened.
 *
 * Decrements by one; it does NOT clear the record. Clearing is what a correct password
 * earns, and using it here would mean a caller could wipe an accumulated backoff by
 * provoking a non-password failure — a missing vault blob, a storage fault — instead of
 * guessing. One reservation in, one reservation out.
 */
export async function releaseAttempt(): Promise<void> {
  await serial(async () => {
    const rec = parseAttempts(await storageGet(ATTEMPTS_KEY));
    if (rec.fails <= 0) return;
    const fails = rec.fails - 1;
    if (fails === 0) {
      await storageRemove(ATTEMPTS_KEY);
      return;
    }
    // The arm-time is dropped along with the guess: the delay it carried was earned by an
    // attempt that turned out never to have been one.
    await storageSet(ATTEMPTS_KEY, JSON.stringify({ fails, blockedUntil: 0 }));
  });
}

/**
 * A wrong password, counted after the fact.
 *
 * Only for a caller that could not reserve up front. Every path in this app uses
 * `beginAttempt`, so this exists for the arithmetic to stay testable on its own.
 */
export async function noteAttemptFailure(now = Date.now()): Promise<void> {
  await serial(async () => {
    const next = recordFailure(parseAttempts(await storageGet(ATTEMPTS_KEY)), now);
    await storageSet(ATTEMPTS_KEY, JSON.stringify(next));
  });
}

/**
 * A correct password: forget the whole history.
 *
 * Cleared rather than decremented, because the thing being counted is consecutive wrong
 * guesses. Someone who knows the password has answered the question the counter was
 * asking, and leaving a residue would make an honest typo earlier in the day escalate the
 * delay on an unrelated attempt tomorrow.
 */
export async function noteAttemptSuccess(): Promise<void> {
  await serial(async () => storageRemove(ATTEMPTS_KEY));
}
