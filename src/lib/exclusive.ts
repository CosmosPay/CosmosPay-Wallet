/**
 * One-at-a-time execution for the flows that move money.
 *
 * `busy` cannot do this job. It is React state, and every signing flow awaits the
 * confirmation gate BEFORE setting it, so two taps in the same frame both read
 * `false`, both queue a prompt, and — since the gate queues instead of overwriting —
 * both resolve, one after the other. The second closure still holds the draft from
 * before the first one reset it: the same payment, submitted twice, with a fresh
 * sequence number. A claim taken synchronously is what the second tap loses to.
 *
 * Why a module and not five `claim`/`release` pairs in the store: the pairs were
 * hand-written at nine call sites with two different shapes, each one holding the
 * `await` of the signing gate OUTSIDE its `try`. The gate does not throw today, so
 * nothing leaked — but the day it does, that flow's button is dead until a reload,
 * five times over. Owning the whole cycle here makes forgetting a release
 * unrepresentable, and puts the logic somewhere a test can reach: the store hook is
 * not reachable from `node:test`.
 */

/** The flows that must not overlap. A union so a typo cannot claim a fresh slot. */
// 'password' is not a money flow, but it re-seals every wallet AND every device-lock
// envelope, so it must not interleave with one that is mid-await holding the old password.
export type FlowKey = 'send' | 'swap' | 'lp-deposit' | 'lp-withdraw' | 'offramp' | 'trustline' | 'password';

export interface ExclusiveRunner {
  /**
   * Run `fn` unless `key` is already running, in which case return `busy` without
   * calling it. The claim is released however `fn` settles.
   */
  run<T>(key: FlowKey, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
  /** Drop every claim. `lock()` calls this: a flow abandoned with the session gone
   *  must not keep its slot held for the next unlock. */
  clear(): void;
}

export function createExclusiveRunner(): ExclusiveRunner {
  const inFlight = new Set<FlowKey>();
  return {
    async run(key, fn) {
      if (inFlight.has(key)) return { ran: false };
      inFlight.add(key);
      try {
        return { ran: true, value: await fn() };
      } finally {
        inFlight.delete(key);
      }
    },
    clear() {
      inFlight.clear();
    },
  };
}
