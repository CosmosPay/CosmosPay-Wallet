import { KVRow } from '@/ui/KVRow';
import { cx } from '@/lib/cx';
import '@/styles/features/fiat/forms.css';

/** One label/value line inside a quote summary card.
 *  `last` drops the hairline; everything else is the shared KVRow. */
export function QuoteRow({ label, val, last }: { label: string; val: string; last?: boolean }) {
  return <KVRow label={label} value={val} className={cx('fiat-quote-row', last && 'fiat-quote-row-last')} />;
}
