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
        // The device-lock enrolment holds a copy of the OLD password, so it is
        // re-sealed inside this call. It can also be dropped — the user may dismiss
        // the prompt — and that is reported rather than thrown: the password change
        // itself already succeeded by then.
        const { deviceAuthDropped } = await changePassword(cur, next, {
          title: t('devAuth.rewrapTitle'),
          reason: t('devAuth.enrollReason'),
          cancel: t('common.cancel'),
        });
        await store.refreshDeviceAuth();
        if (deviceAuthDropped.length) {
          store.flash(t('devAuth.droppedOnPwdChange', { names: deviceAuthDropped.join(', ') }), 'info');
        } else {
          store.flash(t('settings.pwdUpdated'), 'ok');
        }
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
