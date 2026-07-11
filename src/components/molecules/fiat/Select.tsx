import type { CSSProperties, ReactNode } from 'react';
import '@/styles/screens/fiat/shared.css';

/** Native <select> styled to match the app's pill inputs (glass + chevron). Keeps the
 *  OS picker (best for mobile) while looking on-brand. `style` is merged onto the label
 *  so it can flex inside a row. */
export function Select({ label, value, onChange, children, style }: { label?: string; value: string; onChange: (v: string) => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="fiat-field" style={style}>
      {label && <div className="fiat-field-label">{label}</div>}
      <div className="fiat-select-wrap">
        <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} className="fiat-input fiat-select">
          {children}
        </select>
        <span className="fiat-select-chevron">▼</span>
      </div>
    </label>
  );
}
