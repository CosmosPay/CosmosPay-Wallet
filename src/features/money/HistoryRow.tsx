import type { WalletStore } from '@/state/store';
import { trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/money/rows.css';

/** Leading glyph per operation kind (anything unmapped gets the neutral dot). */
const ICONS: Record<string, string> = { sent: '↑', received: '↓', create: '↓', swap: '⇅', fee: '%' };
/** Title i18n key per kind, and the finer key per fee kind. */
const TITLES: Record<string, string> = {
  sent: 'history.sent',
  received: 'history.received',
  swap: 'history.swap',
  create: 'history.created',
};
const FEE_TITLES: Record<string, string> = { liquidity: 'history.feeLiquidity', swap: 'history.feeSwap' };

/** One activity row (send / receive / swap / create / other), linking to the explorer.
 *  Direction and failed/amount colours come from modifier classes; `index` picks
 *  the entrance-delay rung (`dense` on the full History screen). */
export function HistoryRow({ item, store, index = 0, dense = false }: { item: HistoryOp; store: WalletStore; index?: number; dense?: boolean }) {
  const t = store.t;
  const url = explorerTxUrl(store.network, item.hash);
  const date = new Date(item.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const amount = trim(parseFloat(item.amount || '0'), 4);
  const title =
    item.kind === 'fee'
      ? t(FEE_TITLES[item.feeKind ?? ''] ?? 'history.fee')
      : t(TITLES[item.kind] ?? 'history.other');
  const sub =
    item.kind === 'swap'
      ? `${trim(parseFloat(item.fromAmount || '0'), 4)} ${item.fromCode} → ${amount} ${item.code}`
      : item.counterparty
        ? shortAddr(item.counterparty)
        : '';
  // Money in (+) / money out (−). Fees are money out, so they sign like a send;
  // a swap nets in, so it always shows '+'.
  const inbound = item.kind === 'received' || item.kind === 'create';
  const outbound = item.kind === 'sent' || item.kind === 'fee';
  const sign = item.kind === 'swap' ? '+' : inbound ? '+' : outbound ? '−' : '';
  const amountText = item.amount || item.kind === 'swap' ? `${sign}${amount} ${item.code}` : '';
  // Left icon tinted by direction for at-a-glance scanning: green = money in,
  // red = money out, plain white = no value transfer (swaps, signatures, config…).
  const Wrapper: any = url ? 'a' : 'div';
  return (
    <Wrapper
      {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}
      className={cx('tap money-hist-row', staggerClass(index, dense))}
    >
      <div
        className={cx(
          'glass-soft money-hist-icon',
          inbound && 'money-hist-icon--in',
          item.kind === 'sent' && 'money-hist-icon--out',
          item.failed && 'is-failed',
        )}
      >
        {ICONS[item.kind] ?? '•'}
      </div>
      <div className="f1 min0">
        <div className="money-hist-title">
          {title}{item.failed && <span className="money-hist-failed-tag"> · {t('history.failed')}</span>}
        </div>
        {sub && <div className="money-hist-sub">{sub}</div>}
      </div>
      <div className="t-right shrink0">
        {amountText && (
          <div
            className={cx(
              'money-hist-amount',
              item.failed ? 'money-hist-amount--danger is-failed' : sign === '+' && 'money-hist-amount--up',
            )}
          >
            {amountText}
          </div>
        )}
        <div className="money-hist-date">{date}</div>
      </div>
    </Wrapper>
  );
}
