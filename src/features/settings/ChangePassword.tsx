import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { appPasswordOk } from '@/lib/validate';
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
  // The SAME rule onboarding enforces. This used to be length-only, so a wallet created
  // under "8 + upper + lower + digit" could be re-sealed under `aaaaaaaa` — and so could
  // every device-lock envelope holding a copy of it. The store re-checks it too.
  const ok = cur.length > 0 && appPasswordOk(next) && !busy;

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
