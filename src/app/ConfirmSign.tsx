import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setPwd('');
    setErr('');
    setBusy(false);
    setDeviceBusy(false);
  }, [req]);

  if (!req) return null;

  const submit = async () => {
    if (!pwd || busy) return;
    setBusy(true);
    setErr('');
    const okPwd = await store.checkPassword(pwd);
    setBusy(false);
    if (okPwd) {
      store.resolveConfirm(true);
    } else {
      setErr(t('confirmSig.wrongPwd'));
      setPwd('');
    }
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
                await store.confirmWithDevice();
              } finally {
                setDeviceBusy(false);
              }
            }}
            className="confirm-sign-device"
          />
        )}
        <div className="flexr g10">
          <button onClick={() => store.resolveConfirm(false)} className="glass-soft confirm-sign-cancel">
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
