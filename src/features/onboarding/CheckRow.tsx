import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/features/onboarding/atoms.css';

/**
 * A checkbox and its sentence. A real `<input type="checkbox">` inside a `<label>`, so
 * keyboard, screen readers and a tap anywhere on the sentence all work; the drawn box is
 * decoration over the hidden input. A link inside the sentence (the Terms) opens the link
 * and does not toggle the box — the browser does not activate a label through a link.
 */
export function CheckRow({ on, onToggle, children, className }: { on: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <label className={cx('ob-check', className)}>
      <input type="checkbox" className="ob-check-input" checked={on} onChange={onToggle} />
      <span className={cx('ob-check-box', on && 'is-on')} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="ob-check-tick">
          <path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="ob-check-text">{children}</span>
    </label>
  );
}
