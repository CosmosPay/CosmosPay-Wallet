import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/features/onboarding/atoms.css';

/** Muted intro paragraph under the BackBar (screens tune margin-bottom via className). */
export function Desc({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ob-desc', className)}>{children}</div>;
}
