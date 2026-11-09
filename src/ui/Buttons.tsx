import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';

/** The two full-width pill actions, with snap's ink fill on hover (`.ink`). Callers
 *  compose extra layout through `className` (e.g. `f1` inside a row) — never a `style`
 *  prop. `type="submit"` makes the primary action its form's submit (Swap's): it used to be
 *  dropped here, so that button rendered as a plain button and a click submitted nothing. */
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