import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, Spinner } from '@/components/parts';
import { Field } from '@/components/molecules/onboarding';
import { changePassword } from '@/lib/vault';
import '@/styles/screens/settings/settings.css';

/** Inline "change password" sub-form (current + new password → vault re-encrypt). */
export function ChangePassword({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = cur.length > 0 && next.length >= 8 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await changePassword(cur, next);
      store.flash(t('settings.pwdUpdated'), 'ok');
      onDone();
    } catch (e) {
      store.flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-subform">
      <Field label={t('settings.currentPwd')} value={cur} onChange={setCur} type="password" placeholder={t('settings.currentPwd')} />
      <Field label={t('settings.newPwd')} value={next} onChange={setNext} type="password" placeholder={t('pwd.min')} />
      <PrimaryButton disabled={!ok} onClick={submit}>{busy ? <Spinner /> : t('settings.savePwd')}</PrimaryButton>
    </div>
  );
}
