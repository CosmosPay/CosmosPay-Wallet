import '@/styles/screens/settings/export.css';

/** A revealed secret block: title + (seed grid | mono value box) + copy button.
 *  The copied colour flips via the `.is-copied` modifier class. */
export function Reveal({ title, value, mono, copied, onCopy, grid, copyLabel, copiedLabel }: { title: string; value: string; mono: boolean; copied: boolean; onCopy: () => void; grid?: boolean; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="export-reveal">
      <div className="label-up export-reveal-title">{title}</div>
      {grid ? (
        <div className="export-word-grid">
          {value.split(' ').map((w, i) => (
            <div key={i} className="glass row g8 export-word">
              <span className="export-word-num">{i + 1}</span>
              <span className="export-word-text">{w}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={mono ? 'glass export-value-box export-mono' : 'glass export-value-box'}>{value}</div>
      )}
      <button onClick={onCopy} className={copied ? 'glass-soft export-copy-btn is-copied' : 'glass-soft export-copy-btn'}>{copied ? copiedLabel : copyLabel}</button>
    </div>
  );
}
