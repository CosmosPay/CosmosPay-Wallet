import type { WalletStore } from '@/components/store';
import { PrimaryButton, GhostButton, Logo } from '@/components/parts';
import { LangSelect } from '@/components/flags';
import { APP_VERSION } from '@/lib/config';
import '@/styles/screens/onboarding/welcome.css';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="col welcome-screen">
      {/* justify-content depends on whether the cancel link is shown */}
      <div className={store.addingWallet ? 'row welcome-topbar is-adding' : 'row welcome-topbar'}>
        {store.addingWallet && (
          <div onClick={() => store.cancelAddWallet()} className="tap row g8 welcome-cancel">
            <span className="welcome-cancel-arrow">‹</span> {t('common.cancel')}
          </div>
        )}
        <LangSelect value={store.lang} onChange={store.setLang} />
      </div>
      <div className="col center f1 welcome-hero">
        <div className="welcome-logo">
          <Logo size={104} />
        </div>
        <div className="welcome-title">Cosmos Pay</div>
        <div className="welcome-sub">{t('welcome.subtitle')}</div>
      </div>
      <div className="col g12">
        <PrimaryButton onClick={() => store.startCreate()} className="welcome-create">
          {t('welcome.create')}
        </PrimaryButton>
        <GhostButton onClick={() => { store.setImportText(''); store.setScreen('import'); }}>
          {t('welcome.import')}
        </GhostButton>
        <div className="welcome-footer">
          {t('welcome.producer')} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
