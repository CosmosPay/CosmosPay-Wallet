import '@/styles/screens/fiat/shared.css';

/** One label/value line inside a quote summary card. */
export function QuoteRow({ label, val, last }: { label: string; val: string; last?: boolean }) {
  return (
    <div className={last ? 'row between fiat-quote-row fiat-quote-row-last' : 'row between fiat-quote-row'}>
      <span className="t-muted-13">{label}</span>
      <span className="fiat-quote-val">{val}</span>
    </div>
  );
}
