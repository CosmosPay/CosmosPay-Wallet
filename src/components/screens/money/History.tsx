import { useEffect } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar, Spinner } from '@/components/parts';
import { HistoryRow, GenesisRow } from './shared';

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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner color="var(--text)" /></div>
      ) : (
        <div style={{ marginTop: '6px' }}>
          {items.map((it, i) => <HistoryRow key={it.id} item={it} store={store} delay={i * 0.03} />)}
          {/* Visual-only marker closing the list: when this wallet started using Cosmos Pay. */}
          <GenesisRow store={store} delay={items.length * 0.03} />
        </div>
      )}
    </div>
  );
}
