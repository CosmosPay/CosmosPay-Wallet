import type { WalletStore } from '@/state/store';
import '@/styles/features/wallet/home.css';

/**
 * The way out of Pollar, on Home, for a wallet whose key Pollar still holds.
 *
 * On Home rather than only in Profile because the new sign-in no longer creates wallets
 * like this one: its owner is the person most likely to miss that the wallet they use is
 * the old kind. Worded as what they gain — the key on their own device — not as a
 * deprecation notice. Shares the activate card's surface; see `ActivateCard`.
 */
export function MigrateBanner({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="glass card home-activate">
      <div className="home-activate-title">{t('migrate.bannerTitle')}</div>
      <div className="home-activate-desc">{t('migrate.bannerDesc')}</div>
      <button onClick={() => store.setScreen('migrate')} className="home-activate-btn">
        {t(store.migrationTarget ? 'migrate.bannerResume' : 'migrate.bannerCta')}
      </button>
    </div>
  );
}
