import '@/styles/screens/extras/operations.css';

/** One row in the operations hub: round glyph + label (+ optional sub) + chevron. */
export function OpRow({ glyph, label, sub, onClick }: { glyph: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="tap row g14 operations-row">
      <div className="glass-soft center shrink0 operations-glyph">{glyph}</div>
      <div className="f1 min0">
        <div className="operations-row-label">{label}</div>
        {sub && <div className="t-dim-12">{sub}</div>}
      </div>
      <span className="operations-chevron">›</span>
    </div>
  );
}
