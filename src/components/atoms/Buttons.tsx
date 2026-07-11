import type { ReactNode, CSSProperties } from 'react';

export function PrimaryButton({
  children,
  onClick,
  disabled,
  style,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={className ? `btn-primary ${className}` : 'btn-primary'} style={style}>
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  style,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={className ? `btn-ghost ${className}` : 'btn-ghost'} style={style}>
      {children}
    </button>
  );
}
