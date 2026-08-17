import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/kv-row.css';

/**
 * A label/value line inside a summary card.
 *
 * There were six hand-rolled copies of this: `molecules/cosmospay/CosmosPayRow`,
 * `molecules/fiat/QuoteRow`, and inline versions in Confirm, About, Success and
 * SignTx. The proof they were one component was in the stylesheets — `.confirm-row`,
 * `.about-row` and `.success-row` were the identical declaration block, and their
 * `-label` rules were byte-identical.
 *
 * `sub` is the secondary line some rows carry (a fiat approximation under an amount);
 * `mono` is for hashes and addresses.
 */
export function KVRow({
  label,
  value,
  sub,
  mono,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('kv-row', className)}>
      <span className="kv-row-label">{label}</span>
      <div className="kv-row-right">
        <div className={cx('kv-row-val', mono && 'is-mono')}>{value}</div>
        {sub && <div className="t-dim-12">{sub}</div>}
      </div>
    </div>
  );
}
