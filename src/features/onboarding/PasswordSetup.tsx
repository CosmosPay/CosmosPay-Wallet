import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { Criterion } from '@/features/onboarding/Criterion';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { SignInConflict } from '@/features/onboarding/SignInConflict';
import { Field } from '@/ui/Field';
import { APP_PWD_CRITERIA, MIN_APP_PWD_LEN, appPasswordOk } from '@/lib/validate';
import '@/styles/features/onboarding/password-setup.css';

export function PasswordSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  /**
   * The sign-in path has a second step here; the seed path does not.
   *
   * A sign-in skips `profile-setup` — the email is the one the sign-in proved — and that
   * is the screen where the two optional consents are asked. A social wallet was once
   * created with `metricsOptIn` absent for exactly that reason, which is the same outcome
   * as declining except that nobody was ever asked. The question goes here for that flow:
   * after the password, before the wallet exists, so the answer is written into the
   * profile at creation rather than patched into it afterwards.
   *
   * A step inside this screen rather than a screen of its own, and the password is the
   * reason: a separate screen would have to carry a typed password across a navigation,
   * and this app deliberately keeps passwords out of the store (see "The session is not
   * a field" in CLAUDE.md). Here it stays in this component's state, exactly as it
   * already did, and leaves it only as an argument to `finishOnboarding`.
   */
  const signIn = store.hasSignInDraft;
  /**
   * A passkey is offered FIRST wherever it can be: a first wallet, on a build that can run
   * a passkey ceremony. It is one tap and nothing to remember, and on the sign-in path it
   * also opens the backup on the next device. The password stays one tap away for anyone
   * who prefers it — or whose authenticator turns out not to support what the wallet needs,
   * which the store reports and this screen answers by showing the password form.
   *
   * Not on a device that already holds wallets: those share one password, and a new wallet
   * joins it (`finishOnboarding` reuses the session's key). The phone app asks its native
   * plugin, and an iPhone before iOS 18 or an Android before 9 answers no.
   */
  const passkeyOffer = store.passkeyPossible && !store.hasSession && store.wallets.length === 0;
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Live criteria — each row below flips to green as it's satisfied. The rules come from
  // `lib/validate`, not from literals here: this screen and the change-password form used
  // to define them separately and disagreed, so a password that onboarding refused could
  // be set from Settings a minute later.
  const lenOk = APP_PWD_CRITERIA.length(pwd);
  const upperOk = APP_PWD_CRITERIA.upper(pwd);
  const digitOk = APP_PWD_CRITERIA.digit(pwd);
  const lowerOk = APP_PWD_CRITERIA.lower(pwd);
  const uncommonOk = APP_PWD_CRITERIA.uncommon(pwd);
  const match = pwd === confirm && confirm.length > 0;
  const ok = appPasswordOk(pwd) && match && !store.busy;

  /*
   * The steps are stops on the navigation stack (`goStep`), so every back — the header's,
   * the browser's, the mouse's — walks them: consents → password → the passkey offer. The
   * first step is the offer where a passkey can be made, the form elsewhere; a browser that
   * turns out unable to make one (the store learns it from the first ceremony) lands on the
   * form. The consents need the password typed here: arriving on them without it (forward,
   * after leaving the screen) shows the form.
   */
  const first = passkeyOffer ? 'choose' : 'password';
  const step =
    store.navStep === 'consents' && signIn && appPasswordOk(pwd) && match
      ? 'consents'
      : store.navStep === 'password' || store.navStep === 'consents'
        ? 'password'
        : first;
  // `goBack` and never `setScreen`: two flows arrive here — the seed one from
  // `profile-setup`, and a first-run sign-in straight from `sign-in` — and only the
  // navigation stack knows which (the screen table's fallback covers an empty one).
  const back = store.goBack;

  if (step === 'choose') {
    const createWithPasskey = async () => {
      setPasskeyBusy(true);
      try {
        await store.finishOnboardingWithPasskey();
      } finally {
        setPasskeyBusy(false);
      }
    };
    return (
      <div className="scr screen col">
        <ScreenHeader
          title={t('passkey.protectTitle')}
          desc={t(signIn ? 'passkey.protectDescSignIn' : 'passkey.protectDesc')}
          onBack={back}
        />
        <SignInConflict store={store} className="pwd-setup-note" />
        <Notice className="pwd-setup-note">{t('passkey.protectNote')}</Notice>

        {/* The sign-in path asks its two consents where it collects the password; the
            passkey path collects none, so it asks here, before the wallet exists. The seed
            path already asked on `profile-setup`. */}
        {signIn && <OptionalConsents store={store} />}

        <div className="spacer" />
        <div className="kb-dock col g10">
          <PasskeyButton label={t('passkey.create')} busy={passkeyBusy || store.busy} onClick={createWithPasskey} />
          <GhostButton onClick={() => store.goStep('password')}>{t('passkey.usePasswordInstead')}</GhostButton>
        </div>
      </div>
    );
  }

  if (step === 'consents') {
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('setup.optionalTitle')} desc={t('setup.optionalDesc')} onBack={back} />

        <SignInConflict store={store} className="pwd-setup-note" />
        <OptionalConsents store={store} />

        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton disabled={store.busy} onClick={() => store.finishOnboarding(pwd)}>
            {store.busy ? <Spinner /> : t('pwd.create')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col">
      {/* On the sign-in path this password also seals the cloud backup, and it is the one
          the NEXT device will ask for — which the seed path's copy does not say, and has to. */}
      <ScreenHeader title={t('pwd.title')} desc={t(signIn ? 'signin.passwordDesc' : 'pwd.desc')} onBack={back} />

      <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} placeholder={t('pwd.min', { n: MIN_APP_PWD_LEN })} />
      <Field password label={t('pwd.repeat')} value={confirm} onChange={setConfirm} placeholder={t('pwd.repeat')} />

      {/* criteria checklist — states update live as the user types */}
      <div className="col g8 pwd-setup-criteria">
        <Criterion met={lenOk}>{t('pwd.critLen', { n: MIN_APP_PWD_LEN })}</Criterion>
        <Criterion met={upperOk}>{t('pwd.critUpper')}</Criterion>
        <Criterion met={digitOk}>{t('pwd.critDigit')}</Criterion>
        <Criterion met={lowerOk}>{t('pwd.critLower')}</Criterion>
        <Criterion met={uncommonOk}>{t('pwd.critUncommon')}</Criterion>
        <Criterion met={match}>{t('pwd.critMatch')}</Criterion>
      </div>

      <div className="spacer" />
      <div className="kb-dock">
        {/* On the sign-in path this only advances a step — the wallet is created by the
            button on the consent step, so the label must not promise otherwise. */}
        <PrimaryButton disabled={!ok} onClick={() => (signIn ? store.goStep('consents') : store.finishOnboarding(pwd))}>
          {store.busy ? <Spinner /> : t(signIn ? 'common.continue' : 'pwd.create')}
        </PrimaryButton>
      </div>
    </div>
  );
}
