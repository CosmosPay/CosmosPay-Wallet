import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { MIN_PWD_LEN } from '@/constants/settings';
import '@/styles/features/settings/settings.css';

/**
 * Inline "change password" sub-form.
 *
 * The work is `store.changeAppPassword`, not a direct `lib/vault.changePassword` call.
 * This screen used to make that call itself, which made it the one place a `.tsx` mutated
 * state the store was still holding a stale copy of — and it also meant this file owned
 * the OS-prompt copy for re-wrapping the device-lock enrolments. Both now live in the
 * store; a successful change ends the session, so there is nothing to report back here.
 */
export function ChangePassword({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, run] = useBusy();
  const ok = cur.length > 0 && next.length >= MIN_PWD_LEN && !busy;

  const submit = () =>
    run(async () => {
      if (await store.changeAppPassword(cur, next)) onDone();
    });

  return (
    <div className="settings-subform">
      <Field label={t('settings.currentPwd')} value={cur} onChange={setCur} type="password" placeholder={t('settings.currentPwd')} />
      <Field label={t('settings.newPwd')} value={next} onChange={setNext} type="password" placeholder={t('pwd.min')} />
      <PrimaryButton disabled={!ok} onClick={submit}>{busy ? <Spinner /> : t('settings.savePwd')}</PrimaryButton>
    </div>
  );
}
