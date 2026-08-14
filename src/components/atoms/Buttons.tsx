import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

/** The two full-width pill actions. Callers compose extra layout through
 *  `className` (e.g. `f1` inside a row) — never a `style` prop. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={cx('btn-primary', className)}>
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={cx('btn-ghost', className)}>
      {children}
    </button>
  );
}
