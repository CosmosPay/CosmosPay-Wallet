import type { WalletStore } from '@/components/store';
import { Logo } from '@/components/parts';
import { staggerClass } from '@/constants/parts';
import '@/styles/screens/money/shared.css';

/** Visual-only history marker: when this wallet started using Cosmos Pay. Shown
 *  instead of an empty-history box and as the closing row of the full history. */
export function GenesisRow({ store, index = 0, dense = false }: { store: WalletStore; index?: number; dense?: boolean }) {
  const date = store.meta?.createdAt
    ? new Date(store.meta.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <div className={`money-genesis-row ${staggerClass(index, dense)}`}>
      <div className="glass-soft money-genesis-icon">
        <Logo size={19} />
      </div>
      <div className="f1 min0">
        <div className="money-genesis-title">{store.t('history.genesis')}</div>
        <div className="t-dim-12">Cosmos Pay</div>
      </div>
      {/* no amount here — a heart takes its place */}
      <div className="t-right shrink0">
        <div className="money-genesis-heart">❤️</div>
        <div className="money-genesis-date">{date}</div>
      </div>
    </div>
  );
}
