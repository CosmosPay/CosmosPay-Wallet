import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Criterion } from '@/features/onboarding/Criterion';
import { Desc } from '@/features/onboarding/Desc';
import { Field } from '@/ui/Field';
import '@/styles/features/onboarding/password-setup.css';

export function PasswordSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  // Live criteria — each row below flips to green as it's satisfied.
  const lenOk = pwd.length >= 8;
  const upperOk = /[A-Z]/.test(pwd);
  const digitOk = /\d/.test(pwd);
  const lowerOk = /[a-z]/.test(pwd);
  const match = pwd === confirm && confirm.length > 0;
  const ok = lenOk && upperOk && digitOk && lowerOk && match && !store.busy;

  const back = store.goBack;

  return (
    <div className="scr screen col">
      <BackBar title={t('pwd.title')} onBack={back} />
      <Desc className="pwd-setup-desc">{t('pwd.desc')}</Desc>

      <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} placeholder={t('pwd.min')} />
      <Field password label={t('pwd.repeat')} value={confirm} onChange={setConfirm} placeholder={t('pwd.repeat')} />

      {/* criteria checklist — states update live as the user types */}
      <div className="col g8 pwd-setup-criteria">
        <Criterion met={lenOk}>{t('pwd.critLen')}</Criterion>
        <Criterion met={upperOk}>{t('pwd.critUpper')}</Criterion>
        <Criterion met={digitOk}>{t('pwd.critDigit')}</Criterion>
        <Criterion met={lowerOk}>{t('pwd.critLower')}</Criterion>
        <Criterion met={match}>{t('pwd.critMatch')}</Criterion>
      </div>

      <div className="spacer" />
      <PrimaryButton disabled={!ok} onClick={() => store.finishOnboarding(pwd)}>
        {store.busy ? <Spinner /> : t('pwd.create')}
      </PrimaryButton>
    </div>
  );
}
