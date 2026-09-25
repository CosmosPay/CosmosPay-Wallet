import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { Spinner } from '@/ui/Spinner';
import { CheckRow } from '@/features/onboarding/CheckRow';
import { Desc } from '@/features/onboarding/Desc';
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
 *  - the old phrase, if it ever turns up, no longer signs for the account.
 *
 * The list is the INTERSECTION of what both servers will act for. An account only one of
 * them knows cannot be recovered — one signature never reaches the threshold — so showing
 * it would be offering a button that fails at the last step.
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

  const only = accounts?.length === 1 ? accounts[0].address : null;
  const address = chosen ?? only;
  const ready = !!address && !!pwd && ack && !store.busy;

  return (
    <div className="scr screen col">
      <BackBar title={t('recover.title')} onBack={store.goBack} />
      <Desc className="recover-desc">{t('recover.desc')}</Desc>

      {pendingCodes ? (
        <div className="glass-soft col g8 recover-codes">
          <div className="recover-codes-title">{t('recover.codesTitle')}</div>
          <div className="desc">{t('recover.codesDesc', { email: pendingCodes.email })}</div>
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
        </div>
      ) : accounts === null ? (
        <div className="row recover-loading">
          <Spinner />
          <span>{t('recover.looking')}</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="recover-empty">{t('recovery.error.noAccounts')}</div>
      ) : (
        <>
          <div className="col g8 recover-list">
            {accounts.map((a) => (
              <button
                key={a.address}
                onClick={() => setChosen(a.address)}
                className={cx('tap glass row between recover-item', address === a.address && 'is-on')}
              >
                <span className="recover-item-addr">{shortAddr(a.address, 8, 8)}</span>
                <span className="recover-item-mark">{address === a.address ? '✓' : ''}</span>
              </button>
            ))}
          </div>

          <Field password label={t('recover.newPwdLabel')} value={pwd} onChange={setPwd} />
          <OptionalConsents store={store} />

          <div className="glass-soft col g8 recover-warn">
            <div className="recover-warn-text">{t('recover.phraseWarn')}</div>
            <CheckRow on={ack} onToggle={() => setAck(!ack)}>
              {t('recover.phraseAck')}
            </CheckRow>
          </div>
        </>
      )}

      <div className="spacer" />
      {!pendingCodes && (
        <div className="kb-dock">
          <PrimaryButton disabled={!ready} onClick={() => address && void store.recoverWallet(address, pwd)}>
            {store.busy ? <Spinner /> : t('recover.cta')}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
