import type { ReactNode } from 'react';

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
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={className ? `btn-primary ${className}` : 'btn-primary'}>
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
    <button onClick={onClick} className={className ? `btn-ghost ${className}` : 'btn-ghost'}>
      {children}
    </button>
  );
}
