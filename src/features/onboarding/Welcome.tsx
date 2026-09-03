import type { WalletStore } from '@/state/store';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Logo } from '@/ui/Logo';
import { LangSelect } from '@/ui/LangSelect';
import { APP_VERSION } from '@/constants/app';
import '@/styles/features/onboarding/welcome.css';
import { cx } from '@/lib/cx';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="col welcome-screen">
      {/* justify-content depends on whether the cancel link is shown */}
      <div className={cx('row welcome-topbar', store.addingWallet && 'is-adding')}>
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
        {/*
          Social login, offered here because this is where someone looks for it — and
          gated on `canUsePollar` rather than always shown, because it is not always
          possible. The bridge that runs the handshake authenticates with the wallet's
          CosmosPay API key, so this can only work when a wallet on this device already
          has one: in practice, the "add a wallet" path reached from Profile. On a true
          first run there is no key yet and the button is absent, which is the honest
          outcome — a visible button that can only ever explain why it cannot proceed is
          worse than no button. Lifting that limit needs the developer platform to mint
          keys carrying the `pollar:*` scopes.
        */}
        {store.canUsePollar() && (
          <GhostButton onClick={() => store.setScreen('social-login')}>
            {t('pollar.title')}
          </GhostButton>
        )}
        <div className="welcome-footer">
          {t('welcome.producer')} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
