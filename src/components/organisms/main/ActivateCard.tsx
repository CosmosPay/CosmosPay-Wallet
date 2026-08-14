import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/parts';
import { useBusy } from '@/components/hooks';
import '@/styles/screens/main/home.css';

/** Not-yet-activated account card: fund via Friendbot (testnet) or show the address (mainnet).
 *  Uses a LOCAL busy so funding doesn't spin the unrelated CosmosPay card's button. */
export function ActivateCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const testnet = !!store.network.friendbot;
  const [busy, run] = useBusy();
  return (
    <div className="glass card home-activate">
      <div className="home-activate-title">{t('home.activate')}</div>
      <div className="home-activate-desc">
        {t('home.activateDesc')}
        {testnet ? t('home.activateTestnet') : t('home.activateMainnet')}
      </div>
      {testnet ? (
        <button onClick={() => run(() => store.fund())} disabled={busy} className="home-activate-btn">
          {busy ? <Spinner /> : t('home.getTestXlm')}
        </button>
      ) : (
        <button onClick={() => store.setScreen('receive')} className="home-activate-btn">
          {t('home.viewAddress')}
        </button>
      )}
    </div>
  );
}
