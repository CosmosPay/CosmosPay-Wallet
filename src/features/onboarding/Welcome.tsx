import { useMemo } from 'react';
import type { WalletStore } from '@/state/store';
import { welcomeGreeting } from '@/lib/greeting';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { ExternalLink } from '@/ui/ExternalLink';
import { ArrowLeftIcon, CosmosMark } from '@/ui/Icons';
import { QuickPrefs } from '@/ui/QuickPrefs';
import { PRIVACY_URL, TERMS_URL } from '@/constants/app';
import { WelcomeHero } from '@/features/onboarding/WelcomeHero';
import '@/styles/features/onboarding/welcome.css';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  // Random per visit, like Unlock's: stable while the screen is up, a new one next time.
  const greeting = useMemo(() => welcomeGreeting(t), [t]);
  return (
    <div className="col welcome-screen auth-center">
      {/* The screen's name for assistive technology; on a phone the hero says it on screen.
          On a desktop window the welcome below is the heading, so this one steps aside. */}
      <h1 className="sr-only auth-chrome">Cosmos Pay</h1>
      {/* .auth-chrome: on a desktop window before a session, the brand panel on the right
          carries these controls and the motion (src/app/AuthAside.tsx). */}
      <div className={store.addingWallet ? 'row between welcome-topbar auth-chrome' : 'row welcome-topbar auth-chrome'}>
        {/* While adding a wallet the left corner is the way back. */}
        {store.addingWallet && (
          <button type="button" onClick={() => store.cancelAddWallet()} className="row g8 welcome-cancel">
            <ArrowLeftIcon className="welcome-cancel-icon" />
            {t('common.cancel')}
          </button>
        )}
        <QuickPrefs
          t={t}
          lang={store.lang}
          onLang={store.setLang}
          theme={store.theme}
          onTheme={store.setThemePref}
        />
      </div>

      <WelcomeHero theme={store.theme} className="auth-chrome" />

      {/* On a desktop window the hero is in the brand panel, so the column itself says whose
          wallet this is and greets the person (the user's call): the Cosmos C, the mark alone
          and not the full lockup, a greeting that varies with the visit and the hour, and one
          line. .auth-only: never on a phone, where the hero carries both. */}
      <div className="welcome-head auth-only">
        <span className="welcome-mark" role="img" aria-label="Cosmos Pay Wallet">
          <CosmosMark className="welcome-mark-glyph" />
        </span>
        <h1 className="welcome-title">{greeting}</h1>
        <p className="welcome-lead">{t('welcome.lead')}</p>
      </div>

      {/* One decision: create or restore. How to back it up (words or an account) is the
          next screen's, so the local wallet and the account-backed one start from the same
          door — the account is a backup, not a different kind of wallet. */}
      <div className="col g14 welcome-doors">
        <PrimaryButton onClick={() => store.setScreen('backup-choice')}>{t('welcome.create')}</PrimaryButton>
        <GhostButton onClick={() => store.setScreen('restore-choice')}>{t('welcome.import')}</GhostButton>
      </div>
      {/* Both doors lead to a wallet, and the account path has no checkbox of its own, so
          the Terms and the privacy policy are stated here, under the buttons, before either
          is taken. */}
      <p className="welcome-legal">
        {t('welcome.legal')}
        <ExternalLink href={TERMS_URL}>{t('backup.termsLink')}</ExternalLink>{' '}
        {/* "and the Privacy Policy." travels as one piece, so the connector never dangles
            at the end of a line away from the link it introduces. */}
        <span className="welcome-legal-tail">
          {t('welcome.legalAnd').trim()} <ExternalLink href={PRIVACY_URL}>{t('welcome.privacyLink')}</ExternalLink>.
        </span>
      </p>
    </div>
  );
}
