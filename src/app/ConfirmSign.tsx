import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { DeviceAuthButton } from '@/ui/DeviceAuthButton';
import { cx } from '@/lib/cx';
import '@/styles/app/confirm-sign.css';

/** Password gate shown before any signing action (toggleable in Settings). */
export function ConfirmSign({ store }: { store: WalletStore }) {
  const t = store.t;
  const req = store.confirmReq;
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  /** Synchronous re-entry guard — see `submit`. */
  const inFlight = useRef(false);

  useEffect(() => {
    setPwd('');
    setErr('');
    setBusy(false);
    setDeviceBusy(false);
    inFlight.current = false;
  }, [req]);

  if (!req) return null;

  const submit = async () => {
    // A ref, checked first: `busy` is React state, so two Enter keydowns in the same frame
    // both read `false` and both start a full PBKDF2 derivation — each one a password
    // attempt against the ladder. The state flag stays for the disabled button.
    if (!pwd || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErr('');
    const res = await store.checkPassword(pwd);
    inFlight.current = false;
    setBusy(false);
    if (res.ok) {
      // Answered by id: the check above is ~200ms of PBKDF2, and an auto-lock in that
      // window empties the queue. Resolving by position would then grant whatever request
      // arrived next.
      store.resolveConfirm(true, req.id);
      return;
    }
    // The store decides the sentence — a throttled attempt is not a wrong password, and
    // telling someone with the right password that it is wrong is worse than saying wait.
    setErr(res.message);
    if (res.reason === 'wrong') setPwd('');
  };

  return (
    <div className="confirm-sign-overlay">
      <div className="glass confirm-sign-card">
        <div className="confirm-sign-icon-row">
          <div className="glass-soft center confirm-sign-icon">✎</div>
        </div>
        <div className="confirm-sign-title">{req.title}</div>
        {req.message && <div className="confirm-sign-msg">{req.message}</div>}
        <input
          type="password"
          value={pwd}
          autoFocus
          placeholder={t('pwd.label')}
          onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className={cx('input confirm-sign-input', err && 'has-err')}
        />
        {err && <div className="confirm-sign-err">{err}</div>}
        {/* No auto-prompt here, unlike the unlock screen: this gate can be raised by
            a dapp, and a signing sheet that appears without a tap is how a user
            approves something they never read. */}
        {store.deviceAuthReady && (
          <DeviceAuthButton
            kind={store.deviceAuthKind}
            label={t('devAuth.signWith', { method: store.deviceAuthMethod })}
            busy={deviceBusy || busy}
            onClick={async () => {
              setDeviceBusy(true);
              setErr('');
              try {
                await store.confirmWithDevice(req.id);
              } finally {
                setDeviceBusy(false);
              }
            }}
            className="confirm-sign-device"
          />
        )}
        <div className="flexr g10">
          <button onClick={() => store.resolveConfirm(false, req.id)} className="glass-soft confirm-sign-cancel">
            {t('common.cancel')}
          </button>
          <button onClick={submit} disabled={!pwd || busy} className="glass-bright confirm-sign-submit">
            {busy ? <Spinner /> : t('confirmSig.sign')}
          </button>
        </div>
      </div>
    </div>
  );
}
