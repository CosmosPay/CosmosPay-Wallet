import type { WalletStore } from '@/state/store';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { LangSelect } from '@/ui/LangSelect';
import { APP_VERSION } from '@/constants/app';
import '@/styles/features/onboarding/welcome.css';
import { cx } from '@/lib/cx';
import { Icon } from '@/ui/Icon';
import { ChainLogo } from '@/ui/ChainLogo';
import { SWAP_NETWORKS } from '@/lib/swapRoute';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="col welcome-screen">
      {/* justify-content depends on whether the cancel link is shown */}
      <div className={cx('row welcome-topbar', store.addingWallet && 'is-adding')}>
        {store.addingWallet && (
          <div onClick={() => store.cancelAddWallet()} className="tap row g8 welcome-cancel">
            <Icon name="back" size={18} className="welcome-cancel-arrow" /> {t('common.cancel')}
          </div>
        )}
        <LangSelect value={store.lang} onChange={store.setLang} />
      </div>
      <div className="col center f1 welcome-hero">
        {/* El lockup oficial (isotipo + "cosmos pay"), no el nombre tipeado: la
            marca pide que el nombre vaya siempre dibujado. Es blanco, y la clase
            logo-img lo invierte a negro en el tema claro, igual que el isotipo. */}
        {/* The networks one phrase holds, slowly orbiting the mark — the product in one
            picture. Each sits on a fixed rung of the ring (.welcome-orbit-<i>). */}
        <div className="welcome-orbit" aria-hidden="true">
          <div className="welcome-orbit-ring">
            {SWAP_NETWORKS.map((n, i) => (
              <span key={n} className={`welcome-orbit-item welcome-orbit-${i}`}>
                <ChainLogo chain={n} size={34} />
              </span>
            ))}
          </div>
          <span className="welcome-orbit-core" />
        </div>
        <div className="welcome-logo">
          <img
            src={`${import.meta.env.BASE_URL}brand/lockup-cosmos-pay.svg`}
            className="brand-logo logo-img welcome-lockup"
            alt="Cosmos Pay"
            draggable={false}
          />
        </div>
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
          Sign in with Google, GitHub or an email code — offered here, unconditionally,
          because this is where someone looks for it and a first run is the case it exists
          for. It creates a wallet on this device, or restores the one a previous device
          backed up; see lib/signIn.ts.
        */}
        <GhostButton onClick={() => store.setScreen('sign-in')}>
          {t('signin.cta')}
        </GhostButton>
        <div className="welcome-footer">
          {t('welcome.producer')} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
