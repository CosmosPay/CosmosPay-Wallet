import type { ReactNode } from 'react';
import '@/styles/components/back-bar.css';

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
      <div onClick={onBack} className={closeIcon ? 'tap glass-soft circle-btn back-bar-btn is-close' : 'tap glass-soft circle-btn back-bar-btn'}>
        {closeIcon ? '✕' : '‹'}
      </div>
    </div>
  );
}
