import { cx } from '@/lib/cx';
import '@/styles/screens/fiat/shared.css';

/** One label/value line inside a quote summary card. */
export function QuoteRow({ label, val, last }: { label: string; val: string; last?: boolean }) {
  return (
    <div className={cx('row between fiat-quote-row', last && 'fiat-quote-row-last')}>
      <span className="t-muted-13">{label}</span>
      <span className="fiat-quote-val">{val}</span>
    </div>
  );
}
