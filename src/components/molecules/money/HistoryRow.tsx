import type { WalletStore } from '@/components/store';
import { trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';
import '@/styles/screens/money/shared.css';

/** One activity row (send / receive / swap / create / other), linking to the explorer.
 *  Direction and failed/amount colours come from modifier classes; delay stays inline. */
export function HistoryRow({ item, store, delay = 0 }: { item: HistoryOp; store: WalletStore; delay?: number }) {
  const t = store.t;
  const url = explorerTxUrl(store.network, item.hash);
  const date = new Date(item.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const icon = item.kind === 'swap' ? '⇅' : item.kind === 'received' || item.kind === 'create' ? '↓' : item.kind === 'sent' ? '↑' : '•';
  const title =
    item.kind === 'sent' ? t('history.sent')
    : item.kind === 'received' ? t('history.received')
    : item.kind === 'swap' ? t('history.swap')
    : item.kind === 'create' ? t('history.created')
    : t('history.other');
  const sub = item.kind === 'swap'
    ? `${trim(parseFloat(item.fromAmount || '0'), 4)} ${item.fromCode} → ${trim(parseFloat(item.amount || '0'), 4)} ${item.code}`
    : item.counterparty ? shortAddr(item.counterparty) : '';
  const sign = item.kind === 'sent' ? '−' : item.kind === 'received' || item.kind === 'create' ? '+' : '';
  const amountText = item.kind === 'swap'
    ? `+${trim(parseFloat(item.amount || '0'), 4)} ${item.code}`
    : item.amount ? `${sign}${trim(parseFloat(item.amount), 4)} ${item.code}` : '';
  // Left icon tinted by direction for at-a-glance scanning: green = money in,
  // red = money out, plain white = no value transfer (swaps, signatures, config…).
  const inbound = item.kind === 'received' || item.kind === 'create';
  const iconMod = inbound ? 'money-hist-icon--in' : item.kind === 'sent' ? 'money-hist-icon--out' : '';
  const amountMod = item.failed ? 'money-hist-amount--danger' : sign === '+' || item.kind === 'swap' ? 'money-hist-amount--up' : '';
  const Wrapper: any = url ? 'a' : 'div';
  return (
    <Wrapper
      {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}
      className="tap money-hist-row"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className={`glass-soft money-hist-icon ${iconMod}${item.failed ? ' is-failed' : ''}`}>{icon}</div>
      <div className="f1 min0">
        <div className="money-hist-title">
          {title}{item.failed && <span className="money-hist-failed-tag"> · {t('history.failed')}</span>}
        </div>
        {sub && <div className="money-hist-sub">{sub}</div>}
      </div>
      <div className="t-right shrink0">
        {amountText && <div className={`money-hist-amount ${amountMod}${item.failed ? ' is-failed' : ''}`}>{amountText}</div>}
        <div className="money-hist-date">{date}</div>
      </div>
    </Wrapper>
  );
}
