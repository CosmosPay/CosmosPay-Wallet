import type { WalletStore } from '@/state/store';
import { CosmosMark } from '@/ui/Icons';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/money/rows.css';

/** The list's last row: the day this wallet started, under the Cosmos C. */
export function GenesisRow({ store, index = 0, dense = false }: { store: WalletStore; index?: number; dense?: boolean }) {
  const date = store.meta?.createdAt
    ? new Date(store.meta.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <div className={cx('activity-row is-genesis', staggerClass(index, dense))}>
      <span className="activity-mark" aria-hidden="true">
        <CosmosMark className="activity-genesis-mark" />
      </span>
      <div className="activity-main">
        <span className="activity-title">{store.t('history.genesis')}</span>
        <span className="activity-sub">Cosmos Wallet</span>
      </div>
      <div className="activity-end">
        <span className="activity-time">{date}</span>
      </div>
    </div>
  );
}
