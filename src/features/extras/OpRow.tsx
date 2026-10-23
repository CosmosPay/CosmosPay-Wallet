import { Icon, type IconName } from '@/ui/Icon';
import '@/styles/features/extras/operations.css';

/** One row in the operations hub: round glyph + label (+ optional sub) + chevron. */
export function OpRow({ glyph, label, sub, onClick }: { glyph: IconName; label: string; sub?: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="tap row g14 operations-row">
      <div className="glass-soft center shrink0 operations-glyph"><Icon name={glyph} size={20} /></div>
      <div className="f1 min0">
        <div className="operations-row-label">{label}</div>
        {sub && <div className="t-dim-12">{sub}</div>}
      </div>
      <Icon name="chevron-right" size={20} className="operations-chevron" />
    </div>
  );
}
