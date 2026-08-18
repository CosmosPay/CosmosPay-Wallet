import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/field.css';
import '@/styles/features/fiat/forms.css';

/** Native <select> styled to match the app's pill inputs (glass + chevron). Keeps the
 *  OS picker (best for mobile) while looking on-brand. `className` lands on the label
 *  so callers can compose a layout atom (e.g. `f1`) to flex it inside a row. */
export function Select({ label, value, onChange, children, className }: { label?: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', 'is-soft', className)}>
      {label && <div className="field-label">{label}</div>}
      <div className="fiat-select-wrap">
        <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} className="input is-soft fiat-select">
          {children}
        </select>
        <span className="fiat-select-chevron">▼</span>
      </div>
    </label>
  );
}
