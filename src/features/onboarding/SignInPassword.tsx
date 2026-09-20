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
import '@/styles/features/onboarding/sign-in-password.css';

/**
 * The password a finished sign-in still needs.
 *
 * RESTORE — the account has a backup: the password it was sealed under opens it, and on a
 * first run that password becomes this device's too. PROTECT — a new wallet on a device
 * that already has a password: that password seals the new backup, so the person keeps
 * one password everywhere.
 *
 * "Forgot the password?" is here and not hidden, because there is no reset: the platform
 * cannot open the backup, so the only way forward without the password is a NEW wallet
 * that replaces it. The screen says what that gives up — the wallet at that address, unless
 * the recovery phrase was written down somewhere — and asks for an explicit acknowledgement
 * before the store is allowed to send `replaceBackup`.
 */
export function SignInPassword({ store }: { store: WalletStore }) {
  const t = store.t;
  const pending = store.signInPending;
  const [pwd, setPwd] = useState('');
  const [forgot, setForgot] = useState(false);
  const [ack, setAck] = useState(false);

  // A sign-in lives in memory only; after a reload there is nothing to finish here.
  useEffect(() => {
    if (!pending) store.setScreen('sign-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  if (!pending) return null;

  const restoring = !!pending.backupAddress && !pending.replace;
  const firstRun = !store.hasSession;
  const submit = () => {
    if (pwd && !store.busy) void store.completeSignIn(pwd);
  };

  if (!restoring) {
    return (
      <div className="scr screen col">
        <BackBar title={t('signin.protectTitle')} onBack={store.goBack} />
        <Desc className="sign-in-pwd-desc">
          {t(pending.replace ? 'signin.protectReplaceDesc' : 'signin.protectDesc', { email: pending.email })}
        </Desc>
        <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} />
        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton disabled={!pwd || store.busy} onClick={submit}>
            {store.busy ? <Spinner /> : t('signin.createCta')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col">
      <BackBar title={t('signin.restoreTitle')} onBack={store.goBack} />
      <Desc className="sign-in-pwd-desc">
        {t('signin.restoreDesc', { email: pending.email, address: shortAddr(pending.backupAddress ?? '') })}
      </Desc>
      <Field password label={t('signin.backupPwdLabel')} value={pwd} onChange={setPwd} />

      {/* A first run is an onboarding path, and both onboarding paths ask (CLAUDE.md,
          "Diagnostics"). An unlocked device already answered. */}
      {firstRun && <OptionalConsents store={store} />}

      {!forgot ? (
        <button className="sign-in-pwd-forgot" onClick={() => setForgot(true)}>
          {t('signin.forgot')}
        </button>
      ) : (
        <div className="glass-soft col g8 sign-in-pwd-startover">
          <div className="sign-in-pwd-startover-text">
            {t('signin.startOverWarn', { address: shortAddr(pending.backupAddress ?? '') })}
          </div>
          <CheckRow on={ack} onToggle={() => setAck(!ack)}>
            {t('signin.startOverAck')}
          </CheckRow>
          <button className="btn-ghost" disabled={!ack || store.busy} onClick={store.startOverSignIn}>
            {t('signin.startOverCta')}
          </button>
        </div>
      )}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!pwd || store.busy} onClick={submit}>
          {store.busy ? <Spinner /> : t('signin.restoreCta')}
        </PrimaryButton>
      </div>
    </div>
  );
}
