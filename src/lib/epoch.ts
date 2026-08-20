/**
 * A session epoch tracks the current unlock session's lifetime.
 * Captured before a flow's first await, incremented by lock(), and re-checked
 * immediately before the key is used to ensure the wallet hasn't been locked
 * while waiting on a gateway or user input.
 */

export interface SessionEpoch {
  get(): number;
  increment(): void;
  guard(epoch: number, err: string): void;
}

export function createSessionEpoch(): SessionEpoch {
  let current = 0;
  return {
    get() {
      return current;
    },
    increment() {
      current += 1;
    },
    guard(epoch: number, err: string) {
      if (epoch !== current) throw new Error(err);
    }
  };
}
