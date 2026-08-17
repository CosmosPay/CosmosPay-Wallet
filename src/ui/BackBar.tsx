import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/back-bar.css';

export function BackBar({
  title,
  onBack,
  right,
  closeIcon = false,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  closeIcon?: boolean;
}) {
  return (
    <div className="backbar">
      <span className="f1 back-bar-title">{title}</span>
      {right}
      {/* Exit button pinned top-RIGHT for consistency with the tab screens' header
          control — the same position across every view keeps the muscle memory. */}
      <div onClick={onBack} className={cx('tap glass-soft circle-btn back-bar-btn', closeIcon && 'is-close')}>
        {closeIcon ? '✕' : '‹'}
      </div>
    </div>
  );
}
