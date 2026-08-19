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
  // answer at one full delay stops that from bricking unlock until the date catches up.
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
 * How long the next password attempt must wait, in ms. 0 means "go ahead".
 *
 * Call this BEFORE deriving a key. Called after, it would cost the very PBKDF2 run the
 * backoff exists to deny.
 */
export async function attemptBlockMs(now = Date.now()): Promise<number> {
  return remainingBlockMs(parseAttempts(await storageGet(ATTEMPTS_KEY)), now);
}

/** A wrong password: bump the counter and arm the next delay. */
export async function noteAttemptFailure(now = Date.now()): Promise<void> {
  const next = recordFailure(parseAttempts(await storageGet(ATTEMPTS_KEY)), now);
  await storageSet(ATTEMPTS_KEY, JSON.stringify(next));
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
  await storageRemove(ATTEMPTS_KEY);
}
