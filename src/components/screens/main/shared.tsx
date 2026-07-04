import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';

export function changeColor(n: number) {
  // green up / red down (tokens --up/--down, theme-aware)
  return n >= 0 ? 'var(--up)' : 'var(--down)';
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

/** Circular header back button (extension only — phone/web have the bottom bar).
 *  Returns to the screen the user actually came from (store.back). */
export function BackCircle({ store }: { store: WalletStore }) {
  return (
    <div onClick={() => store.back('home')} className="tap glass-soft circle-btn" title={store.t('tab.home')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}
