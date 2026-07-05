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
      <div onClick={onBack} className="tap glass-soft circle-btn" style={{ fontSize: closeIcon ? '17px' : '22px' }}>
        {closeIcon ? '✕' : '‹'}
      </div>
      <span className="f1 back-bar-title">{title}</span>
      {right}
    </div>
  );
}
