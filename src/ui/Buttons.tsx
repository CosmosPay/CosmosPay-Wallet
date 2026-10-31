import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';

/** The two full-width pill actions, with snap's ink fill on hover (`.ink`). Callers
 *  compose extra layout through `className` (e.g. `f1` inside a row) — never a `style`
 *  prop. */
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
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx('btn-primary ink', className)}
      {...inkHandlers}
    >
      {children}
    </button>
  );
}

export function GhostButton({
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
    <button type="button" onClick={onClick} disabled={disabled} className={cx('btn-ghost ink', className)} {...inkHandlers}>
      {children}
    </button>
  );
}
