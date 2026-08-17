import type { ReactNode } from 'react';
import '@/styles/features/onboarding/shared.css';

/** Muted intro paragraph under the BackBar (screens tune margin-bottom via className). */
export function Desc({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `ob-desc ${className}` : 'ob-desc'}>{children}</div>;
}
