import type { WalletStore } from '@/state/store';
import { trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';
import { staggerClass } from '@/lib/stagger';
import { useCopied } from '@/hooks/useCopied';
import { ExternalLink } from '@/ui/ExternalLink';
import { CheckIcon, CopyIcon, DotsIcon, ExchangeIcon, ReceiveIcon, SentIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import '@/styles/features/money/rows.css';

/** Title i18n key per kind, and the finer key per fee kind. */
const TITLES: Record<string, string> = {
  sent: 'history.sent',
  received: 'history.received',
  swap: 'history.swap',
  create: 'history.created',
};
const FEE_TITLES: Record<string, string> = { liquidity: 'history.feeLiquidity', swap: 'history.feeSwap' };

/**
 * One operation, as the Figma's Activity tab draws it: a ringed mark (green in, ink out, the
 * brand blue for a swap), the title over who it was with — that address copies — and the
 * amount over the time. The row opens the operation on the explorer: the title is the link,
 * stretched over the row, so the copy button beside it is not a button inside a link.
 */
export function HistoryRow({ item, store, index = 0, dense = false }: { item: HistoryOp; store: WalletStore; index?: number; dense?: boolean }) {
  const t = store.t;
  const [copied, copy] = useCopied();
  const url = explorerTxUrl(store.network, item.hash);
  const time = new Date(item.createdAt).toLocaleTimeString(store.locale, { hour: '2-digit', minute: '2-digit' });
  const amount = trim(parseFloat(item.amount || '0'), 4);
  const title =
    item.kind === 'fee' ? t(FEE_TITLES[item.feeKind ?? ''] ?? 'history.fee') : t(TITLES[item.kind] ?? 'history.other');
  const inbound = item.kind === 'received' || item.kind === 'create';
  const outbound = item.kind === 'sent' || item.kind === 'fee';
  // A swap nets in, so it signs '+'; fees are money out.
  const sign = item.kind === 'swap' || inbound ? '+' : outbound ? '−' : '';
  const amountText = item.amount || item.kind === 'swap' ? `${sign}${amount} ${item.code}` : '';
  const who = item.counterparty;
  const sub =
    item.kind === 'swap'
      ? `${item.fromCode} → ${item.code}`
      : who
        ? t(inbound ? 'history.from' : 'history.to', { who: shortAddr(who, 6, 4) })
        : '';
  const tone = item.failed ? 'is-failed' : item.kind === 'swap' ? 'is-swap' : inbound ? 'is-in' : 'is-out';
  const Mark = item.kind === 'swap' ? ExchangeIcon : inbound ? ReceiveIcon : outbound ? SentIcon : DotsIcon;

  return (
    <div className={cx('activity-row', staggerClass(index, dense))}>
      <span className={cx('activity-mark', tone)} aria-hidden="true">
        <Mark />
      </span>
      <div className="activity-main">
        {url ? (
          <ExternalLink href={url} className="activity-title activity-link">
            {title}
            {item.failed && <span className="activity-failed"> · {t('history.failed')}</span>}
          </ExternalLink>
        ) : (
          <span className="activity-title">{title}</span>
        )}
        {sub && (
          <span className="activity-sub">
            {sub}
            {who && item.kind !== 'swap' && (
              <button
                type="button"
                onClick={() => copy(who)}
                className={cx('activity-copy', copied && 'is-copied')}
                aria-label={copied ? t('common.copied') : t('history.copyAddress')}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            )}
          </span>
        )}
      </div>
      <div className="activity-end">
        {amountText && (
          <span className={cx('activity-amount', item.failed ? 'is-failed' : sign === '+' ? 'is-up' : sign === '−' && 'is-down')}>
            {amountText}
          </span>
        )}
        <span className="activity-time">{time}</span>
      </div>
    </div>
  );
}
