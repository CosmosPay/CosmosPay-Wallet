import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SignInConflict } from '@/features/onboarding/SignInConflict';
import { Spinner } from '@/ui/Spinner';
import { CheckRow } from '@/ui/CheckRow';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { shortAddr } from '@/lib/format';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import { useKeptState } from '@/hooks/useKeptState';
import { KEPT_INPUT } from '@/constants/keptInputs';
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
  const [upgrade, setUpgrade] = useKeptState(KEPT_INPUT.restorePasskey, true);
  // Before the early return: a hook. The offer below needs both servers to answer.
  const recoveryUp = useRecoveryReachable(store.network);

  /*
   * The EMAIL way in (the user's call): a backup with an email door, on a sign-in whose ID
   * token both recovery servers accept, opens without the old password — the store tries it
   * on its own (`tryEmailRestore`) and the person only sets this device's password. A
   * passkey door that this device can use stays first: one tap, nothing to type at all. The
   * old password is a link away, and the screen falls back to it, in place, when the email
   * way is not there.
   */
  const doorsNow = pending?.backupDoors;
  const emailDoor =
    !!pending?.backupAddress &&
    !pending.replace &&
    !!doorsNow?.recovery &&
    !(store.passkeyPossible && (doorsNow?.passkeys ?? 0) > 0);
  const [emailTry, setEmailTry] = useState<'idle' | 'trying' | 'done'>('idle');
  // The two recovery servers' own codes, when the sign-in carried no ID token to show them.
  const [serverCodes, setServerCodes] = useState<string[]>([]);
  const [oldPassword, setOldPassword] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [devicePassword, setDevicePassword] = useState(false);
  useEffect(() => {
    if (!emailDoor || recoveryUp !== true || emailTry !== 'idle') return;
    setEmailTry('trying');
    void store.tryEmailRestore().finally(() => setEmailTry('done'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailDoor, recoveryUp, emailTry]);

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
          <ScreenHeader
            title={t('signin.protectTitle')}
            desc={t('passkey.protectAddDesc', { email: pending.email })}
            onBack={store.goBack}
          />
          <SignInConflict store={store} />
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
        <ScreenHeader
          title={t('signin.protectTitle')}
          desc={t(pending.replace ? 'signin.protectReplaceDesc' : 'signin.protectDesc', { email: pending.email })}
          onBack={store.goBack}
        />
        <SignInConflict store={store} className="sign-in-pwd-conflict" />
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

  const whole = store.backupRecoverable;
  // Nothing to type where a passkey can lock this device: one tap, and it is also the
  // backup's next door. Elsewhere, or by choice, this device's password.
  const devicePasskey = firstRun && store.passkeyPossible;
  const withPasskeyDevice = async () => {
    setPasskeyBusy(true);
    try {
      await store.recoverBackupWithPasskey();
    } finally {
      setPasskeyBusy(false);
    }
  };
  if (emailDoor && !oldPassword && whole) {
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('signin.restoreTitle')} desc={t('signin.emailRestoreDesc', { email: pending.email })} onBack={store.goBack} />
        <Notice className="sign-in-pwd-note">
          <strong>{t('recover.backupTitle')}</strong>
          <span>{t('recover.backupDesc', { address: shortAddr(whole.address, 8, 8) })}</span>
          {whole.count > 1 && <span>{t('recover.backupMore', { n: whole.count - 1 })}</span>}
        </Notice>
        {devicePasskey && !devicePassword ? (
          <button type="button" className="link-btn sign-in-pwd-link" onClick={() => setDevicePassword(true)}>
            {t('signin.devicePasswordInstead')}
          </button>
        ) : (
          <Field password label={t('recover.newPwdLabel')} value={newPwd} onChange={setNewPwd} />
        )}
        {firstRun && <OptionalConsents store={store} />}
        <button type="button" className="link-btn sign-in-pwd-link" onClick={() => setOldPassword(true)}>
          {t('signin.useOldPassword')}
        </button>
        <div className="spacer" />
        <div className="kb-dock">
          {devicePasskey && !devicePassword ? (
            <PasskeyButton label={t('signin.restoreWithPasskey')} busy={busy} onClick={withPasskeyDevice} />
          ) : (
            <PrimaryButton disabled={!newPwd || busy} onClick={() => void store.recoverBackup(newPwd)}>
              {store.busy ? <Spinner /> : t('recover.backupCta')}
            </PrimaryButton>
          )}
        </div>
      </div>
    );
  }
  // No ID token (the in-app email code): each recovery server emailed its own code. Typed
  // here, they open the backup like the token would — still no password.
  const codesAsked = store.recoveryCodes;
  if (emailDoor && !oldPassword && codesAsked) {
    const filled = Array.from({ length: codesAsked.count }, (_, i) => serverCodes[i] ?? '');
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('signin.codesTitle')} desc={t('signin.codesDesc', { email: codesAsked.email })} onBack={store.goBack} />
        {filled.map((value, i) => (
          <Field
            key={i}
            label={t('recover.codeLabel', { role: String.fromCharCode(65 + i) })}
            value={value}
            onChange={(v) => setServerCodes(filled.map((c, j) => (j === i ? normalizeAccessCode(v) : c)))}
            placeholder={t('cosmospay.codePlaceholder')}
          />
        ))}
        <button type="button" className="link-btn sign-in-pwd-link" onClick={() => setOldPassword(true)}>
          {t('signin.useOldPassword')}
        </button>
        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton
            disabled={store.busy || !filled.every(isAccessCode)}
            onClick={() => void store.submitRecoveryCodes(filled)}
          >
            {store.busy ? <Spinner /> : t('signin.codesCta')}
          </PrimaryButton>
        </div>
      </div>
    );
  }
  if (emailDoor && !oldPassword && (emailTry === 'trying' || (emailTry === 'idle' && recoveryUp === null))) {
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('signin.restoreTitle')} desc={t('signin.emailRestoreDesc', { email: pending.email })} onBack={store.goBack} />
        <div className="row g10 sign-in-pwd-checking" role="status">
          <Spinner tone="text" />
          <span className="f1 min0">{t('signin.checkingEmail')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col">
      <ScreenHeader
        title={t('signin.restoreTitle')}
        desc={t(passkeyDoor ? 'passkey.restoreDesc' : stuck ? 'passkey.restoreElsewhere' : 'signin.restoreDesc', {
          email: pending.email,
          address: shortAddr(pending.backupAddress ?? ''),
        })}
        onBack={store.goBack}
      />

      {passkeyDoor && !showPwd && doors.password && (
        <button type="button" className="link-btn sign-in-pwd-link" onClick={() => setShowPwd(true)}>
          {t('passkey.usePassword')}
        </button>
      )}

      {fieldShown && <Field password label={t('signin.backupPwdLabel')} value={pwd} onChange={setPwd} />}
      {/* The passkey this person signed in with is Authentik's, and it is not a door of the
          backup — which is exactly why they are being asked for a password here. Said, so
          it does not read as the passkey having failed. */}
      {fieldShown && !passkeyDoor && store.passkeyPossible && (
        <Notice className="sign-in-pwd-note">{t('passkey.authentikNote')}</Notice>
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
        <button type="button" className="link-btn sign-in-pwd-link" onClick={() => setForgot(true)}>
          {t(passkeyDoor ? 'passkey.forgot' : 'signin.forgot')}
        </button>
      ) : (
        <div className="col g12 sign-in-pwd-ways">
          {/* Recovery FIRST, because it is the answer that keeps the account. Starting
              over below it gives up the address and everything on it, and is offered only
              because a build without recovery servers — or an account that never turned
              recovery on — has nothing else. */}
          {recoverable && (
            <Notice>
              <span>{t(doors.recovery ? 'signin.recoverEmailOffer' : 'signin.recoverOffer')}</span>
              <GhostButton disabled={busy} onClick={() => store.setScreen('recover')}>
                {t(doors.recovery ? 'signin.recoverEmailCta' : 'signin.recoverCta')}
              </GhostButton>
            </Notice>
          )}
          <Notice tone="danger">
            <span>{t('signin.startOverWarn', { address: shortAddr(pending.backupAddress ?? '') })}</span>
            <CheckRow on={ack} onToggle={() => setAck(!ack)}>
              {t('signin.startOverAck')}
            </CheckRow>
            <button
              type="button"
              className="btn-ghost sign-in-pwd-danger"
              disabled={!ack || busy}
              onClick={store.startOverSignIn}
            >
              {t('signin.startOverCta')}
            </button>
          </Notice>
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
