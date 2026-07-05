import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/parts';
import '@/styles/screens/main/home.css';

/** Not-yet-activated account card: fund via Friendbot (testnet) or show the address (mainnet). */
export function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = !!store.network.friendbot;
  return (
    <div className="glass card home-activate">
      <div className="home-activate-title">{t('home.activate')}</div>
      <div className="home-activate-desc">
        {t('home.activateDesc')}
        {testnet ? t('home.activateTestnet') : t('home.activateMainnet')}
      </div>
      {testnet ? (
        <button onClick={() => store.fund()} disabled={store.busy} className="home-activate-btn">
          {store.busy ? <Spinner /> : t('home.getTestXlm')}
        </button>
      ) : (
        <button onClick={() => store.setScreen('receive')} className="home-activate-btn">
          {t('home.viewAddress')}
        </button>
      )}
    </div>
  );
}
