import { useCallback, useState } from 'react';

/**
 * Run an async action behind a LOCAL busy flag (try/finally), so one card's
 * spinner never reacts to an unrelated global action — and never stays stuck
 * when the action throws.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => unknown) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run] as const;
}
