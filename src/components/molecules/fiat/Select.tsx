import type { ReactNode } from 'react';
import '@/styles/screens/fiat/shared.css';

/** Native <select> styled to match the app's pill inputs (glass + chevron). Keeps the
 *  OS picker (best for mobile) while looking on-brand. `className` lands on the label
 *  so callers can compose a layout atom (e.g. `f1`) to flex it inside a row. */
export function Select({ label, value, onChange, children, className }: { label?: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <label className={className ? `fiat-field ${className}` : 'fiat-field'}>
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
