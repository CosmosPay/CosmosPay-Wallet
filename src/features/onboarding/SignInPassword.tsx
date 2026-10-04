import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { Spinner } from '@/ui/Spinner';
import { CheckRow } from '@/features/onboarding/CheckRow';
import { Desc } from '@/features/onboarding/Desc';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { shortAddr } from '@/lib/format';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import '@/styles/features/onboarding/sign-in-password.css';

/**
 * What a finished sign-in still needs: a password, or a passkey.
 *
 * RESTORE — the account has a backup. A backup with a PASSKEY door, on a build that can ask
 * for one, leads with it: one fingerprint opens the backup, and on a first run this device
 * then opens with that same passkey — nothing typed, nothing to remember. A backup with a
 * PASSWORD door keeps the field, behind a link when the passkey is offered. On a first run
 * restored with the password, one checkbox (on by default where passkeys work) turns the
 * device into a passkey device in the same step and gives the backup a passkey door, so the
 * NEXT device is the one-fingerprint case.
 *
 * PROTECT — a new wallet on a device that already has a password or a passkey: whichever
 * this device opens with also seals the new backup, so the person keeps one way in.
 *
 * "Forgot the password?" is here and not hidden. The server cannot open the backup, so
 * the ways forward without the password are, in order: the backup's EMAIL door, when it has
 * one — proving the inbox to both recovery servers gives the whole wallet back, seed and
 * all, under a new password; SEP-30 recovery (the account survives, the seed does not); or
 * a NEW wallet that replaces the backup. The screen says what the
 * second gives up and asks for an explicit acknowledgement before the store is allowed to
 * send `replaceBackup`.
 */
export function SignInPassword({ store }: { store: WalletStore }) {
  const t = store.t;
  const pending = store.signInPending;
  const [pwd, setPwd] = useState('');
  const [forgot, setForgot] = useState(false);
  const [ack, setAck] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  // On by default wherever it can work: the whole point is that the next device asks for
  // nothing, and a default of off is a default nobody changes.
  const [upgrade, setUpgrade] = useState(true);
  // Before the early return: a hook. The offer below needs both servers to answer.
  const recoveryUp = useRecoveryReachable(store.network);

  // A sign-in lives in memory only; after a reload there is nothing to finish here.
  useEffect(() => {
    if (!pending) store.setScreen('sign-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  if (!pending) return null;

  const restoring = !!pending.backupAddress && !pending.replace;
  // Only worth offering where there are two servers to ask. `recoverable` itself is not
  // loaded here: asking both servers costs two round trips and a token each, and most
  // people who open this screen simply type their password.
  const recoverable = recoveryUp === true;
  const firstRun = !store.hasSession;
  const busy = store.busy || passkeyBusy;

  const withPasskey = async () => {
    setPasskeyBusy(true);
    try {
      await store.completeSignInWithPasskey();
    } finally {
      setPasskeyBusy(false);
    }
  };

  if (!restoring) {
    // A passkey device seals the new backup with its passkey; it has no password to type.
    if (store.passkeyUnlock) {
      return (
        <div className="scr screen col">
          <BackBar title={t('signin.protectTitle')} onBack={store.goBack} />
          <Desc className="sign-in-pwd-desc">{t('passkey.protectAddDesc', { email: pending.email })}</Desc>
          <div className="spacer" />
          <div className="kb-dock">
            <PasskeyButton label={t('signin.createCta')} busy={busy} onClick={withPasskey} />
          </div>
        </div>
      );
    }
    const submitNew = () => {
      if (pwd && !busy) void store.completeSignIn(pwd);
    };
    return (
      <div className="scr screen col">
        <BackBar title={t('signin.protectTitle')} onBack={store.goBack} />
        <Desc className="sign-in-pwd-desc">
          {t(pending.replace ? 'signin.protectReplaceDesc' : 'signin.protectDesc', { email: pending.email })}
        </Desc>
        <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} />
        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton disabled={!pwd || busy} onClick={submitNew}>
            {store.busy ? <Spinner /> : t('signin.createCta')}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  // A box that will not parse reads as a password box: that is what every box before
  // passkeys was, and the store reports the real problem when it tries to open it.
  const doors = pending.backupDoors ?? { password: true, passkeys: 0, recovery: false };
  const passkeyDoor = store.passkeyPossible && doors.passkeys > 0;
  // The field, when there is a password door to type into — up front when it is the only
  // way in, behind a link when the passkey leads.
  const fieldShown = doors.password && (!passkeyDoor || showPwd);
  // A backup only a passkey opens, on a build that cannot ask for one (an old phone, a browser without WebAuthn).
  const stuck = !passkeyDoor && !doors.password;
  // The upgrade is a first-run offer: an unlocked device keeps the way it already opens.
  const offerUpgrade = firstRun && store.passkeyPossible && fieldShown;

  const submitPwd = () => {
    if (pwd && !busy) void store.completeSignIn(pwd, { usePasskey: offerUpgrade && upgrade });
  };

  return (
    <div className="scr screen col">
      <BackBar title={t('signin.restoreTitle')} onBack={store.goBack} />
      <Desc className="sign-in-pwd-desc">
        {t(passkeyDoor ? 'passkey.restoreDesc' : stuck ? 'passkey.restoreElsewhere' : 'signin.restoreDesc', {
          email: pending.email,
          address: shortAddr(pending.backupAddress ?? ''),
        })}
      </Desc>

      {passkeyDoor && !showPwd && doors.password && (
        <button type="button" className="sign-in-pwd-forgot" onClick={() => setShowPwd(true)}>
          {t('passkey.usePassword')}
        </button>
      )}

      {fieldShown && <Field password label={t('signin.backupPwdLabel')} value={pwd} onChange={setPwd} />}
      {/* The passkey this person signed in with is Authentik's, and it is not a door of the
          backup — which is exactly why they are being asked for a password here. Said, so
          it does not read as the passkey having failed. */}
      {fieldShown && !passkeyDoor && store.passkeyPossible && (
        <div className="desc sign-in-pwd-note">{t('passkey.authentikNote')}</div>
      )}
      {offerUpgrade && (
        <CheckRow on={upgrade} onToggle={() => setUpgrade(!upgrade)}>
          {t('passkey.upgradeOnRestore')}
        </CheckRow>
      )}

      {/* A first run is an onboarding path, and both onboarding paths ask (CLAUDE.md,
          "Diagnostics"). An unlocked device already answered. */}
      {firstRun && <OptionalConsents store={store} />}

      {!forgot && !stuck ? (
        <button className="sign-in-pwd-forgot" onClick={() => setForgot(true)}>
          {t(passkeyDoor ? 'passkey.forgot' : 'signin.forgot')}
        </button>
      ) : (
        <div className="glass-soft col g8 sign-in-pwd-startover">
          {/* Recovery FIRST, because it is the answer that keeps the account. Starting
              over below it gives up the address and everything on it, and is offered only
              because a build without recovery servers — or an account that never turned
              recovery on — has nothing else. */}
          {recoverable && (
            <>
              <div className="sign-in-pwd-startover-text">
                {t(doors.recovery ? 'signin.recoverEmailOffer' : 'signin.recoverOffer')}
              </div>
              <button className="btn-ghost" disabled={busy} onClick={() => store.setScreen('recover')}>
                {t(doors.recovery ? 'signin.recoverEmailCta' : 'signin.recoverCta')}
              </button>
              <div className="sign-in-pwd-or">{t('common.or')}</div>
            </>
          )}
          <div className="sign-in-pwd-startover-text">
            {t('signin.startOverWarn', { address: shortAddr(pending.backupAddress ?? '') })}
          </div>
          <CheckRow on={ack} onToggle={() => setAck(!ack)}>
            {t('signin.startOverAck')}
          </CheckRow>
          <button className="btn-ghost" disabled={!ack || busy} onClick={store.startOverSignIn}>
            {t('signin.startOverCta')}
          </button>
        </div>
      )}

      <div className="spacer" />
      <div className="kb-dock col g10">
        {passkeyDoor && !fieldShown && (
          <PasskeyButton label={t('passkey.restore')} busy={busy} onClick={withPasskey} />
        )}
        {fieldShown && (
          <PrimaryButton disabled={!pwd || busy} onClick={submitPwd}>
            {store.busy ? <Spinner /> : t('signin.restoreCta')}
          </PrimaryButton>
        )}
        {passkeyDoor && fieldShown && (
          <PasskeyButton quiet label={t('passkey.restore')} busy={busy} onClick={withPasskey} />
        )}
      </div>
    </div>
  );
}
