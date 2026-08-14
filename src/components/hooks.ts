/** React hooks shared by screens and components. Pure-logic helpers live in
 *  src/lib; anything that holds React state belongs here. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { COPY_FEEDBACK_MS } from '@/constants/parts';

/**
 * Copy a value to the clipboard and raise a "copied" flag for a moment, so the
 * button can swap its label/colour.
 *
 * `key` tells several buttons apart when one screen reveals more than one secret
 * (Export). With a single button the returned key is simply truthy while the
 * flag is up. The timer is cleared on unmount — the hand-rolled `setTimeout`
 * this replaces kept firing into unmounted screens.
 */
export function useCopied(ms = COPY_FEEDBACK_MS) {
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(
    async (value: string, key = 'copied') => {
      await copyText(value);
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(''), ms);
    },
    [ms],
  );
  return [copied, copy] as const;
}

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

/** Smoothly animates towards `target` (ease-out cubic) so value changes visibly
 *  tick up/down instead of jumping — the auto-refresh makes this run every ~30s. */
export function useAnimatedNumber(target: number, ms = 800): number {
  const [val, setVal] = useState(target);
  const valRef = useRef(target);
  useEffect(() => {
    const from = valRef.current;
    if (Math.abs(target - from) < 1e-9) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}
