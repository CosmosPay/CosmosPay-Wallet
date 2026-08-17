import { useEffect } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar, Spinner } from '@/ui/parts';
import { HistoryRow, GenesisRow } from '@/features/money/shared';
import '@/styles/features/money/history.css';

/* ----------------------------- HISTORY ------------------------------ */
/** Recent on-chain activity for the active wallet (payments + swaps), from Horizon. */
export function History({ store }: { store: WalletStore }) {
  const t = store.t;
  // Refresh whenever the screen opens (or the active wallet / network changes).
  useEffect(() => {
    store.loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.meta?.id, store.network.id]);
  const items = store.history;
  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('history.title')} onBack={() => store.go('home', 'home')} />
      {store.historyLoading && items.length === 0 ? (
        <div className="f1 center"><Spinner color="var(--text)" /></div>
      ) : (
        <div className="history-list">
          {items.map((it, i) => <HistoryRow key={it.id} item={it} store={store} delay={i * 0.03} />)}
          {/* Visual-only marker closing the list: when this wallet started using Cosmos Pay. */}
          <GenesisRow store={store} delay={items.length * 0.03} />
        </div>
      )}
    </div>
  );
}
