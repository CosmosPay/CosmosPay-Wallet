import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/screens/onboarding/shared.css';

/** One live-criterion row: grey until met (green ✓); `bad` shows a red ✗ state.
 *  Colour/border/tint come from the `is-met` / `is-bad` modifier classes. */
export function Criterion({ met, bad = false, children }: { met: boolean; bad?: boolean; children: ReactNode }) {
  return (
    <div className={cx('ob-crit', met ? 'is-met' : bad && 'is-bad')}>
      <div className="ob-crit-dot">
        {bad && !met ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ob-crit-tick">
            <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </div>
  );
}
