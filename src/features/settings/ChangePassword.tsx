import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { MIN_PWD_LEN } from '@/constants/settings';
import { changePassword } from '@/lib/vault';
import '@/styles/features/settings/settings.css';

/** Inline "change password" sub-form (current + new password → vault re-encrypt). */
export function ChangePassword({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, run] = useBusy();
  const ok = cur.length > 0 && next.length >= MIN_PWD_LEN && !busy;

  const submit = () =>
    run(async () => {
      try {
        await changePassword(cur, next);
        store.flash(t('settings.pwdUpdated'), 'ok');
        onDone();
      } catch (e) {
        store.flash((e as Error).message, 'err');
      }
    });

  return (
    <div className="settings-subform">
      <Field label={t('settings.currentPwd')} value={cur} onChange={setCur} type="password" placeholder={t('settings.currentPwd')} />
      <Field label={t('settings.newPwd')} value={next} onChange={setNext} type="password" placeholder={t('pwd.min')} />
      <PrimaryButton disabled={!ok} onClick={submit}>{busy ? <Spinner /> : t('settings.savePwd')}</PrimaryButton>
    </div>
  );
}
