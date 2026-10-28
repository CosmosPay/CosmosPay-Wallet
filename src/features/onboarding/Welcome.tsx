import type { WalletStore } from '@/state/store';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { ExternalLink } from '@/ui/ExternalLink';
import { ArrowLeftIcon } from '@/ui/Icons';
import { QuickPrefs } from '@/ui/QuickPrefs';
import { PRIVACY_URL, TERMS_URL } from '@/constants/app';
import { WelcomeHero } from '@/features/onboarding/WelcomeHero';
import '@/styles/features/onboarding/welcome.css';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div className="col welcome-screen">
      {/* The screen's name for assistive technology; on screen the hero says it. */}
      <h1 className="sr-only">Cosmos Pay</h1>
      <div className={store.addingWallet ? 'row between welcome-topbar' : 'row welcome-topbar'}>
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

      <WelcomeHero theme={store.theme} />

      {/* One decision: create or restore. How to back it up (words or an account) is the
          next screen's, so the local wallet and the account-backed one start from the same
          door — the account is a backup, not a different kind of wallet. */}
      <div className="col g14">
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
