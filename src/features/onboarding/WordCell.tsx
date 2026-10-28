import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/features/onboarding/atoms.css';

/** Numbered seed-word cell (Backup grid + Verify slots). State-driven looks come from
 *  modifier classes the caller passes via `className`. A cell the person can act on
 *  (`onClick`) is a button; a cell that only shows a word is not. */
export function WordCell({
  n,
  children,
  className,
  onClick,
  label,
}: {
  n: number;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Accessible name when the visible content is not the whole story (an empty slot). */
  label?: string;
}) {
  const content = (
    <>
      <span className="ob-word-num">{n}</span>
      <span className="ob-word-text">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={label} className={cx('ob-word-cell', className)}>
      {content}
    </button>
  ) : (
    <div className={cx('ob-word-cell', className)}>{content}</div>
  );
}
