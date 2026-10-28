import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { CheckIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { CheckRow } from '@/features/onboarding/CheckRow';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { RECOVERY_SERVER_COUNT } from '@/constants/recovery';
import '@/styles/features/onboarding/recover-account.css';

/**
 * Getting an account back when the device AND the password are gone.
 *
 * The encrypted backup cannot answer this — it only opens with the password — so this is
 * the path SEP-30 exists for: two servers, each holding half of what a signature needs,
 * co-sign a NEW key onto the account. The address survives with everything on it; the old
 * key does not.
 *
 * Two things are said plainly here rather than after the fact, because both surprise
 * people who have just got their money back:
 *
 *  - the recovery phrase changes, and the new one restores a KEY, not this account;
 *  - the old phrase, if it ever turns up, no longer signs for the account;
 *  - the Solana and Monad addresses were the OLD phrase's, so nothing here brings them back.
 *
 * When the inbox holds several backups, ONE proof brings back every one that has an email
 * door, each under the same new password — forgetting the password forgot it for all of them.
 *
 * The list is the INTERSECTION of what both servers will act for. An account only one of
 * them knows cannot be recovered — one signature never reaches the threshold — so showing
 * it would be offering a button that fails at the last step.
 *
 * When the signed-in account's BACKUP has an email door and both servers hand its halves
 * back, that comes first and replaces the list: it restores the wallet itself — the same
 * recovery phrase and the same address on every chain — under a new password, and nothing
 * about the account changes. SEP-30 is what is left when the backup has no such door.
 *
 * Before the list, each server has to be convinced of the inbox ON ITS OWN. A sign-in
 * through Cosmos Pay's Authentik carries an ID token both can verify, and this screen asks
 * nothing. Any other sign-in ends here with two codes, one from each server: two prompts
 * rather than one, because a single code would be one party vouching to the other.
 */
export function RecoverAccount({ store }: { store: WalletStore }) {
  const t = store.t;
  const accounts = store.recoverable;
  const [chosen, setChosen] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [ack, setAck] = useState(false);
  // One per server, filled with '' rather than left sparse: `every` skips holes, and a
  // half-typed pair must not read as complete.
  const [codes, setCodes] = useState<string[]>(() => Array<string>(RECOVERY_SERVER_COUNT).fill(''));
  const pendingCodes = store.recoveryCodes;

  const { loadRecoverable } = store;
  useEffect(() => {
    void loadRecoverable();
  }, [loadRecoverable]);

  // A sign-in lives in memory only; after a reload there is nothing to recover from here.
  useEffect(() => {
    if (!store.signInPending) store.setScreen('sign-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.signInPending]);

  // The whole backup — and every other one filed under this inbox — when both servers
  // returned their halves. The store keeps it per sign-in, so nothing stale shows here.
  const whole = store.backupRecoverable;
  const wholeBackup = !!whole;
  const only = accounts?.length === 1 ? accounts[0].address : null;
  const address = chosen ?? only;
  const ready = !!address && !!pwd && ack && !store.busy;

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('recover.title')} desc={t('recover.desc')} onBack={store.goBack} />

      {pendingCodes ? (
        <section className="col recover-codes" aria-labelledby="recover-codes-title">
          <h2 id="recover-codes-title" className="recover-section-title">{t('recover.codesTitle')}</h2>
          <p className="recover-section-desc">{t('recover.codesDesc', { email: pendingCodes.email })}</p>
          {Array.from({ length: pendingCodes.count }, (_, i) => (
            <Field
              key={i}
              label={t('recover.codeLabel', { role: String.fromCharCode(65 + i) })}
              value={codes[i] ?? ''}
              onChange={(v) =>
                setCodes((cur) => cur.map((c, j) => (j === i ? normalizeAccessCode(v) : c)))
              }
              placeholder={t('cosmospay.codePlaceholder')}
            />
          ))}
          <PrimaryButton
            disabled={store.busy || !codes.every(isAccessCode)}
            onClick={() => void store.submitRecoveryCodes(codes)}
          >
            {store.busy ? <Spinner /> : t('recover.codesCta')}
          </PrimaryButton>
        </section>
      ) : wholeBackup ? (
        <>
          <Notice className="recover-notice">
            <strong className="recover-notice-title">{t('recover.backupTitle')}</strong>
            <span>{t('recover.backupDesc', { address: shortAddr(whole?.address ?? '', 8, 8) })}</span>
            {whole && whole.count > 1 && <span>{t('recover.backupMore', { n: whole.count - 1 })}</span>}
          </Notice>
          <Field password label={t('recover.newPwdLabel')} value={pwd} onChange={setPwd} />
          <OptionalConsents store={store} />
        </>
      ) : accounts === null ? (
        <div className="row recover-loading" role="status">
          <Spinner tone="text" />
          <span>{t('recover.looking')}</span>
        </div>
      ) : accounts.length === 0 ? (
        <Notice tone="danger" className="recover-notice">{t('recovery.error.noAccounts')}</Notice>
      ) : (
        <>
          <div className="col g8 recover-list">
            {accounts.map((a) => (
              <button
                key={a.address}
                type="button"
                aria-pressed={address === a.address}
                onClick={() => setChosen(a.address)}
                className={cx('recover-item', address === a.address && 'is-on')}
              >
                <span className="f1 recover-item-addr">{shortAddr(a.address, 8, 8)}</span>
                {address === a.address && <CheckIcon className="recover-item-mark" />}
              </button>
            ))}
          </div>

          <Field password label={t('recover.newPwdLabel')} value={pwd} onChange={setPwd} />
          <OptionalConsents store={store} />

          <Notice tone="danger" className="recover-warn">
            <span>{t('recover.phraseWarn')}</span>
            <span>{t('recover.otherNetworks', { network: store.network.label })}</span>
            <span>{t('recover.otherChains')}</span>
            <CheckRow on={ack} onToggle={() => setAck(!ack)}>
              {t('recover.phraseAck')}
            </CheckRow>
          </Notice>
        </>
      )}

      <div className="spacer" />
      {!pendingCodes && wholeBackup && (
        <div className="kb-dock">
          <PrimaryButton disabled={!pwd || store.busy} onClick={() => void store.recoverBackup(pwd)}>
            {store.busy ? <Spinner /> : t('recover.backupCta')}
          </PrimaryButton>
        </div>
      )}
      {!pendingCodes && !wholeBackup && (
        <div className="kb-dock">
          <PrimaryButton disabled={!ready} onClick={() => address && void store.recoverWallet(address, pwd)}>
            {store.busy ? <Spinner /> : t('recover.cta')}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
