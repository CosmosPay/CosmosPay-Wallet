import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Criterion } from '@/features/onboarding/Criterion';
import { Desc } from '@/features/onboarding/Desc';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
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
  const [step, setStep] = useState<'password' | 'consents'>('password');
  const signIn = store.hasSignInDraft;

  // Live criteria — each row below flips to green as it's satisfied. The rules come from
  // `lib/validate`, not from literals here: this screen and the change-password form used
  // to define them separately and disagreed, so a password that onboarding refused could
  // be set from Settings a minute later.
  const lenOk = APP_PWD_CRITERIA.length(pwd);
  const upperOk = APP_PWD_CRITERIA.upper(pwd);
  const digitOk = APP_PWD_CRITERIA.digit(pwd);
  const lowerOk = APP_PWD_CRITERIA.lower(pwd);
  const match = pwd === confirm && confirm.length > 0;
  const ok = appPasswordOk(pwd) && match && !store.busy;

  // `goBack` and never `setScreen`: two flows arrive here now — the seed one from
  // `profile-setup`, and a first-run sign-in straight from `sign-in` — and only the
  // navigation stack knows which. The screen table's
  // fallback covers the case where there is no stack (see SCREENS.password).
  // From the consent step, back is the password step: leaving the screen there would
  // discard a password the user has already typed and confirmed.
  const back = step === 'consents' ? () => setStep('password') : store.goBack;

  if (step === 'consents') {
    return (
      <div className="scr screen col">
        <BackBar title={t('setup.optionalTitle')} onBack={back} />
        <Desc className="pwd-setup-desc">{t('setup.optionalDesc')}</Desc>

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
      <BackBar title={t('pwd.title')} onBack={back} />
      {/* On the sign-in path this password also seals the cloud backup, and it is the one
          the NEXT device will ask for — which the seed path's copy does not say, and has to. */}
      <Desc className="pwd-setup-desc">{t(signIn ? 'signin.passwordDesc' : 'pwd.desc')}</Desc>

      <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} placeholder={t('pwd.min', { n: MIN_APP_PWD_LEN })} />
      <Field password label={t('pwd.repeat')} value={confirm} onChange={setConfirm} placeholder={t('pwd.repeat')} />

      {/* criteria checklist — states update live as the user types */}
      <div className="col g8 pwd-setup-criteria">
        <Criterion met={lenOk}>{t('pwd.critLen', { n: MIN_APP_PWD_LEN })}</Criterion>
        <Criterion met={upperOk}>{t('pwd.critUpper')}</Criterion>
        <Criterion met={digitOk}>{t('pwd.critDigit')}</Criterion>
        <Criterion met={lowerOk}>{t('pwd.critLower')}</Criterion>
        <Criterion met={match}>{t('pwd.critMatch')}</Criterion>
      </div>

      <div className="spacer" />
      <div className="kb-dock">
        {/* On the sign-in path this only advances a step — the wallet is created by the
            button on the consent step, so the label must not promise otherwise. */}
        <PrimaryButton disabled={!ok} onClick={() => (signIn ? setStep('consents') : store.finishOnboarding(pwd))}>
          {store.busy ? <Spinner /> : t(signIn ? 'common.continue' : 'pwd.create')}
        </PrimaryButton>
      </div>
    </div>
  );
}
