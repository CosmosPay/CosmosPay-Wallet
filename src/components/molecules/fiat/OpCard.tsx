import type { ReactNode } from 'react';
import '@/styles/screens/fiat/fiat.css';

/** Big tappable operation card (on-ramp / off-ramp) with a round glyph, title + desc. */
export function OpCard({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="tap glass row g14 fiat-op-card">
      <div className="glass-soft center shrink0 fiat-op-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{icon}</svg>
      </div>
      <div className="f1 min0">
        <div className="fiat-title-15">{title}</div>
        <div className="fiat-op-desc">{desc}</div>
      </div>
      <span className="fiat-op-chev">›</span>
    </div>
  );
}
