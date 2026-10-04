import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import { cx } from '@/lib/cx';
import '@/styles/features/settings/recovery.css';

/**
 * The backup's email door (`lib/backupRecovery.ts`): forgot the password, prove the inbox to
 * both recovery servers, get the WHOLE wallet back under a new password.
 *
 * A wallet backed up since the door existed already has it — every sign-in, restore and
 * password change files it. This is for one backed up before: it re-seals the backup behind
 * this device's doors plus the new one. The bargain is said before the button, as SEP-30's
 * is: the two servers together could open the backup, and that is the price of "recover
 * with my email".
 *
 * Only for a backed-up wallet, and only while both servers answer.
 */
export function BackupRecoverySection({ store }: { store: WalletStore }) {
  const t = store.t;
  const [busy, run] = useBusy();
  const [pwd, setPwd] = useState('');
  const reachable = useRecoveryReachable(store.network);
  const meta = store.meta;
  if (!meta?.cloudBackup || reachable !== true) return null;

  const filed = meta.backupRecoveryEmail ?? '';
  const email = meta.email.trim().toLowerCase();

  return (
    <SettingsSection title={t('backupRecovery.title')}>
      <div className="desc recovery-desc">{t('backupRecovery.what')}</div>
      {filed ? (
        <div className="row between recovery-status">
          <span className="recovery-status-on">{t('recovery.statusOn')}</span>
          <span className="recovery-email">{filed}</span>
        </div>
      ) : (
        <>
          <div className="recovery-status">
            <span className="recovery-status-off">{t('recovery.statusOff')}</span>
          </div>
          <div className="recovery-note">{email ? t('backupRecovery.bargain', { email }) : t('recovery.error.noEmail')}</div>
          {/* A passkey device proves itself with the passkey; anything else with the password,
              which is also what the re-sealed backup opens with. */}
          {!store.passkeyUnlock && <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} />}
          <button
            disabled={busy || !email || (!store.passkeyUnlock && !pwd)}
            onClick={() =>
              run(async () => {
                if (await store.enableBackupRecovery(store.passkeyUnlock ? undefined : pwd)) setPwd('');
              })
            }
            className={cx('btn-primary recovery-btn', busy && 'is-busy')}
          >
            {t('backupRecovery.turnOn')}
          </button>
        </>
      )}
    </SettingsSection>
  );
}
