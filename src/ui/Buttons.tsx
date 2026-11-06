import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

/** The two full-width actions, with a neutral CSS hover surface (`.ink`). Callers
 *  compose extra layout through `className` (e.g. `f1` inside a row) — never a `style`
 *  prop. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx('btn-primary ink', className)}
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
    <button type="button" onClick={onClick} disabled={disabled} className={cx('btn-ghost ink', className)}>
      {children}
    </button>
  );
}
