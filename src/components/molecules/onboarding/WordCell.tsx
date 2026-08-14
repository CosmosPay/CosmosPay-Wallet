import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/screens/onboarding/shared.css';

/** Numbered seed-word cell (Backup grid + Verify slots). State-driven looks
 *  come from modifier classes the caller passes via `className`. */
export function WordCell({
  n,
  children,
  className,
  onClick,
}: {
  n: number;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={cx('ob-word-cell', className)}>
      <span className="ob-word-num">{n}</span>
      <span className="ob-word-text">{children}</span>
    </div>
  );
}
