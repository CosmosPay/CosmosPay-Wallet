import { useEffect, useRef, useState } from 'react';

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
