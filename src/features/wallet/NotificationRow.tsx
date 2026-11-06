import type { WalletStore } from '@/state/store';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';
import { ExternalLink } from '@/ui/ExternalLink';
import { ExchangeIcon, ReceiveIcon, SentIcon, WalletIcon } from '@/ui/Icons';

export function NotificationRow({ item, store }: { item: HistoryOp; store: WalletStore }) {
  const { t, locale } = store;
  const Icon = item.kind === 'swap' ? ExchangeIcon : item.kind === 'sent' ? SentIcon : item.kind === 'create' ? WalletIcon : ReceiveIcon;
  const value = Number(item.amount);
  const amount = item.amount && Number.isFinite(value)
    ? `${value.toLocaleString(locale, { maximumFractionDigits: 7 })} ${item.code}`.trim()
    : '';

  let title = t('history.other');
  if (item.failed) title = t('notify.failed');
  else if (item.kind === 'create') title = t('notify.created');
  else if (item.kind === 'received') title = amount ? t('notify.receivedAmount', { amount }) : t('history.received');
  else if (item.kind === 'sent') title = amount ? t('notify.sentAmount', { amount }) : t('history.sent');
  else if (item.kind === 'swap') title = item.fromCode && amount
    ? t('notify.swappedAmount', { from: item.fromCode, amount })
    : t('history.swap');

  const href = explorerTxUrl(store.network, item.hash);
  const content = (
    <>
      <span className="notice-mark" aria-hidden="true"><Icon /></span>
      <span className="notice-copy">
        <span className="notice-title">{title}</span>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
      </span>
    </>
  );
  return href
    ? <ExternalLink href={href} className="notice-entry">{content}</ExternalLink>
    : <div className="notice-entry">{content}</div>;
}
