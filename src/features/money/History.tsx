import { useEffect } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { ActivityList } from '@/features/money/ActivityList';
import '@/styles/features/money/history.css';

/* ----------------------------- HISTORY ------------------------------ */
/** The whole activity of the active wallet on Stellar (payments and swaps), in days. */
export function History({ store }: { store: WalletStore }) {
  const t = store.t;
  const { loadHistory } = store;
  // Refreshed whenever the screen opens, and when the wallet or the network changes.
  useEffect(() => {
    loadHistory();
  }, [loadHistory, store.meta?.id, store.network.id]);
  const items = store.history;
  return (
    <div className="scr screen col pb-104">
      <ScreenHeader title={t('history.title')} onBack={store.goBack} />
      {store.historyLoading && items.length === 0 ? (
        <div className="history-wait">
          <Spinner tone="text" />
        </div>
      ) : (
        <ActivityList store={store} items={items} complete dense />
      )}
    </div>
  );
}
