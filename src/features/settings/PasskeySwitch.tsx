import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { MIN_APP_PWD_LEN, appPasswordOk } from '@/lib/validate';
import '@/styles/features/settings/settings.css';

/**
 * Inline "open this device with a passkey / with a password" sub-form.
 *
 * TO A PASSKEY: the current password, then one sheet. The password is what proves the
 * person may change how the wallet opens, and it stays a door on the cloud backup — it is
 * how they restore on a device without passkeys.
 *
 * TO A PASSWORD: the new password, then one sheet — the passkey's own, which releases the
 * device password the change starts from. The same rule onboarding enforces applies, and
 * the store re-checks it.
 *
 * Either way the store ends the session afterwards and the wallet opens again the new way,
 * which is also the proof that it works.
 */
export function PasskeySwitch({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [busy, run] = useBusy();

  if (!store.passkeyUnlock) {
    return (
      <div className="settings-subform">
        <div className="desc settings-subform-desc">{t('passkey.switchOnDesc')}</div>
        <Field label={t('settings.currentPwd')} value={pwd} onChange={setPwd} type="password" placeholder={t('settings.currentPwd')} />
        <PasskeyButton
          label={t('passkey.create')}
          busy={busy}
          disabled={!pwd}
          onClick={() =>
            run(async () => {
              if (await store.switchToPasskey(pwd)) onDone();
            })
          }
        />
      </div>
    );
  }

  const ok = appPasswordOk(pwd) && !busy;
  return (
    <div className="settings-subform">
      <div className="desc settings-subform-desc">{t('passkey.switchOffDesc')}</div>
      <Field label={t('settings.newPwd')} value={pwd} onChange={setPwd} type="password" placeholder={t('pwd.min', { n: MIN_APP_PWD_LEN })} />
      <PrimaryButton
        disabled={!ok}
        onClick={() =>
          run(async () => {
            if (await store.switchToPassword(pwd)) onDone();
          })
        }
      >
        {busy ? <Spinner /> : t('passkey.switchOffCta')}
      </PrimaryButton>
    </div>
  );
}
