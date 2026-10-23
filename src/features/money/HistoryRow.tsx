import type { MouseEvent } from 'react';
import type { WalletStore } from '@/state/store';
import { Icon, type IconName } from '@/ui/Icon';
import { fmt, trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';
import { timeOf } from '@/lib/activity';
import { useCopied } from '@/hooks/useCopied';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/money/rows.css';

/** Leading glyph per operation kind (anything unmapped gets the neutral dot). */
const ICONS: Record<string, IconName> = {
  sent: 'sent',
  received: 'receive',
  create: 'receive',
  swap: 'exchange',
  fee: 'dollar',
  other: 'zap',
};
/** Title i18n key per kind, and the finer key per fee kind. */
const TITLES: Record<string, string> = {
  sent: 'history.sent',
  received: 'history.received',
  swap: 'history.swap',
  create: 'history.created',
};
const FEE_TITLES: Record<string, string> = { liquidity: 'history.feeLiquidity', swap: 'history.feeSwap' };

/**
 * One activity row, as the design draws it: a coloured disc for the kind (green in, dark
 * out, Cosmic Blue for a swap), the kind over its counterparty with a copy button, the
 * signed amount over its dollar value, and the time at the far right. The day it belongs
 * to is the heading above it (`groupByDay`). Links to the explorer.
 */
export function HistoryRow({ item, store, index = 0, dense = false }: { item: HistoryOp; store: WalletStore; index?: number; dense?: boolean }) {
  const t = store.t;
  const [copied, copy] = useCopied();
  const url = explorerTxUrl(store.network, item.hash);
  const value = parseFloat(item.amount || '0') || 0;
  const amount = trim(value, 6);
  const title =
    item.kind === 'fee'
      ? t(FEE_TITLES[item.feeKind ?? ''] ?? 'history.fee')
      : t(TITLES[item.kind] ?? 'history.other');
  const inbound = item.kind === 'received' || item.kind === 'create';
  const outbound = item.kind === 'sent' || item.kind === 'fee';
  const sub =
    item.kind === 'swap'
      ? `${item.fromCode ?? ''} → ${item.code}`
      : item.counterparty
        ? t(inbound ? 'history.from' : 'history.to', { addr: shortAddr(item.counterparty, 5, 4) })
        : '';
  // Money in (+) / money out (−). Fees are money out, so they sign like a send;
  // a swap nets in, so it always shows '+'.
  const sign = item.kind === 'swap' ? '+' : inbound ? '+' : outbound ? '−' : '';
  const amountText = item.amount || item.kind === 'swap' ? `${sign}${amount} ${item.code}` : '';
  const price = store.prices[item.code]?.usd;
  const usd = price !== undefined && value ? `$ ${fmt(value * price, 2)}` : '';

  const copyCounterparty = (e: MouseEvent) => {
    // The row is a link; the copy button inside it must not follow it.
    e.preventDefault();
    e.stopPropagation();
    if (item.counterparty) void copy(item.counterparty);
  };

  const Wrapper: any = url ? 'a' : 'div';
  return (
    <Wrapper
      {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}
      className={cx('tap money-hist-row', staggerClass(index, dense))}
    >
      <span
        className={cx(
          'money-hist-icon',
          inbound && 'is-in',
          item.kind === 'swap' && 'is-swap',
          outbound && 'is-out',
          item.failed && 'is-failed',
        )}
      >
        <Icon name={ICONS[item.kind] ?? 'zap'} size={20} />
      </span>
      <span className="money-hist-main">
        <span className="money-hist-title">
          {title}
          {item.failed && <span className="money-hist-failed-tag"> · {t('history.failed')}</span>}
        </span>
        {sub && (
          <span className="money-hist-sub">
            <span className="money-hist-sub-text">{sub}</span>
            {item.counterparty && item.kind !== 'swap' && (
              <button
                type="button"
                onClick={copyCounterparty}
                aria-label={t('common.copy')}
                className={cx('money-hist-copy', copied && 'is-copied')}
              >
                <Icon name={copied ? 'check' : 'copy'} size={16} />
              </button>
            )}
          </span>
        )}
      </span>
      <span className="money-hist-values">
        {amountText && (
          <span
            className={cx(
              'money-hist-amount',
              item.failed ? 'is-failed' : sign === '+' ? 'is-up' : sign === '−' ? 'is-down' : null,
            )}
          >
            {amountText}
          </span>
        )}
        {usd && <span className="money-hist-usd">{usd}</span>}
      </span>
      <span className="money-hist-time">{timeOf(item.createdAt, store.locale)}</span>
    </Wrapper>
  );
}
