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
   * The social path has a second step here; the seed path does not.
   *
   * A Pollar login skips `profile-setup` — the provider supplies the name, the email and
   * the avatar — and that is the screen where the two optional consents are asked. So a
   * social wallet was created with `metricsOptIn` absent, which is the same outcome as
   * declining except that nobody was ever asked. The question goes here for that flow:
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
  const social = store.hasPollarDraft;

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
  // `profile-setup`, and a social login straight from `social-login` with its session
  // already redeemed — and only the navigation stack knows which. The screen table's
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
      {/* The social path has no seed to protect — what this password seals is the Pollar
          session — and saying "your recovery phrase" there would describe something the
          user was explicitly told they will never have. */}
      <Desc className="pwd-setup-desc">{t(social ? 'pollar.passwordDesc' : 'pwd.desc')}</Desc>

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
        {/* On the social path this only advances a step — the wallet is created by the
            button on the consent step, so the label must not promise otherwise. */}
        <PrimaryButton disabled={!ok} onClick={() => (social ? setStep('consents') : store.finishOnboarding(pwd))}>
          {store.busy ? <Spinner /> : t(social ? 'common.continue' : 'pwd.create')}
        </PrimaryButton>
      </div>
    </div>
  );
}
