import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/atoms/Spinner';
import '@/styles/components/confirm-sign.css';

/** Password gate shown before any signing action (toggleable in Settings). */
export function ConfirmSign({ store }: { store: WalletStore }) {
  const t = store.t;
  const req = store.confirmReq;
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setPwd('');
    setErr('');
    setBusy(false);
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
          className="input confirm-sign-input"
          style={{ marginBottom: err ? '8px' : '16px' }}
        />
        {err && <div className="confirm-sign-err">{err}</div>}
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
