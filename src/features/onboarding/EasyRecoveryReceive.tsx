import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { useCopied } from '@/hooks/useCopied';
import { qrDataUrl } from '@/lib/qr';
import { countdown, isEasyRecoveryCode } from '@/lib/easyRecovery';
import { EASY_RECOVERY_CODE_LENGTH, EASY_RECOVERY_POLL_MS } from '@/constants/easyRecovery';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import '@/styles/features/onboarding/easy-recovery-receive.css';

/**
 * Easy recovery, the NEW device (src/lib/easyRecovery.ts). Two steps, each a stop on the
 * navigation stack: the QR the other device scans, then the code it shows.
 *
 * The session opens when the screen does and is dropped when it closes (its key with it).
 * The code step comes on its own once the other device has sent the wallet; everything that
 * can go wrong — a wrong code, an expired or burned session — is said here, with the way on
 * (a new QR) as a button the person taps. Nothing moves them off the screen.
 */
export function EasyRecoveryReceive({ store }: { store: WalletStore }) {
  const t = store.t;
  const r = store.easyReceive;
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<'wrongCode' | 'notYet' | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, copy] = useCopied();

  useEffect(() => {
    void store.openEasyReceive();
    return () => store.closeEasyReceive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    setQr(null);
    if (r?.link) void qrDataUrl(r.link).then((url) => live && setQr(url));
    return () => {
      live = false;
    };
  }, [r?.link]);

  // Ask the server while the other device has not sent it yet.
  const open = r?.status === 'open';
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => void store.pollEasyReceive(), EASY_RECOVERY_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, r?.id]);

  // The other device sent it: the code is the next stop.
  useEffect(() => {
    if (r?.status === 'offered' && store.navStep !== 'code') store.goStep('code');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.status]);

  const ended = r?.status === 'ended';
  const endingText = r?.ending === 'burned' ? t('easyRecovery.burned') : r?.ending === 'failed' ? t('easyRecovery.openFailed') : t('easyRecovery.expired');

  /** A fresh QR, from the QR step (the code step goes back to it first). */
  const newQr = () => {
    setCode('');
    setProblem(null);
    if (store.navStep === 'code') store.goBack();
    void store.openEasyReceive();
  };

  const submit = async () => {
    if (!isEasyRecoveryCode(code) || busy) return;
    setBusy(true);
    setProblem(null);
    const res = await store.claimEasyRecovery(code);
    setBusy(false);
    if (res === 'wrongCode' || res === 'notYet') setProblem(res);
    if (res === 'wrongCode') setCode('');
  };

  if (store.navStep === 'code' && r && (r.status === 'offered' || ended)) {
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('easyRecovery.codeTitle')} desc={t('easyRecovery.codeDesc')} onBack={store.goBack} />
        <label className="field">
          <div className="field-label">{t('easyRecovery.codeLabel')}</div>
          <input
            value={code}
            onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, EASY_RECOVERY_CODE_LENGTH))}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            disabled={ended}
            className="input easy-receive-code"
          />
        </label>
        {problem && !ended && (
          <Notice tone="danger" className="easy-receive-notice">
            {problem === 'wrongCode' ? t('easyRecovery.wrongCode', { n: r.attemptsLeft }) : t('easyRecovery.notYet')}
          </Notice>
        )}
        {ended && (
          <Notice tone="danger" className="easy-receive-notice">
            {endingText}
          </Notice>
        )}
        <div className="spacer" />
        <div className="kb-dock">
          {ended ? (
            <PrimaryButton onClick={newQr}>{t('easyRecovery.newQr')}</PrimaryButton>
          ) : (
            <PrimaryButton disabled={!isEasyRecoveryCode(code) || busy} onClick={() => void submit()}>
              {busy ? <Spinner /> : t('easyRecovery.recover')}
            </PrimaryButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('easyRecovery.receiveTitle')} desc={t('easyRecovery.receiveDesc')} onBack={store.goBack} />

      <div className="easy-receive-qr-card">
        {qr && !ended ? (
          <img className="easy-receive-qr" src={qr} alt={t('easyRecovery.qrAlt')} />
        ) : (
          <div className="easy-receive-qr is-empty">{!ended && <Spinner tone="text" />}</div>
        )}
        {r && !ended && r.expiresAt > 0 && (
          <div className="easy-receive-expiry">{t('easyRecovery.expiresIn', { time: countdown(r.expiresAt, now) })}</div>
        )}
      </div>

      {ended ? (
        <Notice tone="danger" className="easy-receive-notice">
          {endingText}
        </Notice>
      ) : (
        <div className="row g10 easy-receive-waiting" role="status">
          <Spinner tone="text" />
          <span className="f1 min0">{t('easyRecovery.waiting')}</span>
          {r?.link && (
            <button type="button" className="link-btn" onClick={() => void copy(r.link)}>
              {copied ? t('common.copied') : t('easyRecovery.copyLink')}
            </button>
          )}
        </div>
      )}

      <div className="spacer" />
      {ended ? (
        <div className="kb-dock">
          <PrimaryButton onClick={newQr}>{t('easyRecovery.newQr')}</PrimaryButton>
        </div>
      ) : r?.status === 'offered' ? (
        <div className="kb-dock">
          <GhostButton onClick={() => store.goStep('code')}>{t('easyRecovery.codeTitle')}</GhostButton>
        </div>
      ) : (
        <Notice className="easy-receive-notice">{t('easyRecovery.receiveNote')}</Notice>
      )}
    </div>
  );
}
