import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Criterion } from '@/features/onboarding/Criterion';
import { Desc } from '@/features/onboarding/Desc';
import { Field } from '@/ui/Field';
import { APP_PWD_CRITERIA, MIN_APP_PWD_LEN, appPasswordOk } from '@/lib/validate';
import '@/styles/features/onboarding/password-setup.css';

export function PasswordSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
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
  const back = store.goBack;

  return (
    <div className="scr screen col">
      <BackBar title={t('pwd.title')} onBack={back} />
      {/* The social path has no seed to protect — what this password seals is the Pollar
          session — and saying "your recovery phrase" there would describe something the
          user was explicitly told they will never have. */}
      <Desc className="pwd-setup-desc">{t(store.hasPollarDraft ? 'pollar.passwordDesc' : 'pwd.desc')}</Desc>

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
        <PrimaryButton disabled={!ok} onClick={() => store.finishOnboarding(pwd)}>
          {store.busy ? <Spinner /> : t('pwd.create')}
        </PrimaryButton>
      </div>
    </div>
  );
}
