import type { ReactNode } from 'react';
import '@/styles/screens/onboarding/shared.css';

/** Checkbox row in the app's style (used by Backup consents + optional opt-ins).
 *  The checked look is driven by the `is-on` modifier class, not inline styles. */
export function CheckRow({ on, onToggle, children, className }: { on: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <div onClick={onToggle} className={className ? `tap ob-check ${className}` : 'tap ob-check'}>
      <div className={on ? 'ob-check-box is-on' : 'ob-check-box'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="ob-check-tick">
          <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="ob-check-text">{children}</span>
    </div>
  );
}
