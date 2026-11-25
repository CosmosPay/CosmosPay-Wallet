import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { RECOVERY_OFFER_DISMISSED_PREFIX } from '@/constants/recovery';
import { PrimaryButton } from '@/ui/Buttons';
import { HomeCard } from '@/features/wallet/HomeCard';

/** Read and write the per-account "not now". Browser storage can be absent or refuse. */
function wasDismissed(address: string): boolean {
  try {
    return !!address && localStorage.getItem(RECOVERY_OFFER_DISMISSED_PREFIX + address) === '1';
  } catch {
    return false;
  }
}
function rememberDismissed(address: string): void {
  try {
    localStorage.setItem(RECOVERY_OFFER_DISMISSED_PREFIX + address, '1');
  } catch {
    /* the card simply comes back next time */
  }
}

/**
 * "Protect your account if you lose this device": the backup's email door
 * (`lib/backupRecovery.ts`), offered where people actually are instead of in Settings.
 *
 * It offers the email door, never SEP-30 signers. The door brings back the WHOLE wallet
 * (the same recovery phrase and the same address on every chain) and puts nothing on the
 * ledger: no signers, no XLM reserve, no funded account needed. It rests on the same two
 * servers and the same proof of the inbox, so it asks for no trust SEP-30 does not.
 * SEP-30 stays in Settings for a wallet without a cloud backup, the one case the door
 * cannot cover (`RecoverySection`).
 *
 * A wallet signed in, restored or given a new password since the door existed already has
 * it, so this mostly reaches backups made before. Turning it on re-seals the backup, which
 * takes this device's password, or its passkey where that is how it unlocks.
 *
 * "Not now" is remembered per account, and Settings keeps the same control for later.
 */
export function ProtectAccountCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const meta = store.meta;
  const address = store.publicKey ?? '';
  const email = (meta?.email ?? '').trim();
  const [dismissed, setDismissed] = useState(() => wasDismissed(address));
  const [pwd, setPwd] = useState('');
  const [busy, run] = useBusy();

  // A switch to another wallet is another account, with its own answer.
  useEffect(() => {
    setDismissed(wasDismissed(address));
    setPwd('');
  }, [address]);

  // No backup means no box for the door to open; a filed door means nothing left to offer.
  if (dismissed || !email || !meta?.cloudBackup || meta.backupRecoveryEmail) return null;

  const passkey = store.passkeyUnlock;
  const dismiss = () => {
    rememberDismissed(address);
    setDismissed(true);
  };

  return (
    <HomeCard title={t('recoveryCard.title')}>
      <p className="home-card-desc">{t('recoveryCard.desc', { email })}</p>
      {/* A passkey device proves itself with the passkey; anything else with the password,
          which is also what the re-sealed backup opens with. */}
      {!passkey && <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} />}
      <PrimaryButton
        disabled={busy || (!passkey && !pwd)}
        onClick={() =>
          void run(async () => {
            if (await store.enableBackupRecovery(passkey ? undefined : pwd)) setPwd('');
          })
        }
      >
        {busy ? <Spinner /> : t('recoveryCard.cta')}
      </PrimaryButton>
      <button type="button" onClick={dismiss} className="link-btn home-card-link">
        {t('recoveryCard.later')}
      </button>
    </HomeCard>
  );
}
