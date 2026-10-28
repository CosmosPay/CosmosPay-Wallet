import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { useQrScanner } from '@/hooks/useQrScanner';
import { cameraFailureKey } from '@/lib/camera';
import { countdown, parseLink, type EasyRecoveryLink } from '@/lib/easyRecovery';
import { EASY_RECOVERY_POLL_MS } from '@/constants/easyRecovery';
import { CheckRow } from '@/ui/CheckRow';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { CheckIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { PasskeyButton } from '@/ui/PasskeyButton';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import '@/styles/features/settings/easy-recovery-send.css';

/**
 * Easy recovery, the OLD device (src/lib/easyRecovery.ts): the wallet goes to the device that
 * shows the QR. Three steps, each a stop on the navigation stack: scan (or paste the link),
 * confirm and unlock, then the code to type on the other device.
 *
 * The confirmation is the part that matters. The one way this is abused is a page showing
 * its own QR to someone who believes they are claiming something; so the screen says plainly
 * that this copies the whole wallet, asks the person to state the other device is theirs,
 * and the code it ends on is one they are told never to hand to anyone.
 */
export function EasyRecoverySend({ store }: { store: WalletStore }) {
  const t = store.t;
  const s = store.easySend;
  const step = store.navStep;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [link, setLink] = useState<EasyRecoveryLink | null>(null);
  const [pasted, setPasted] = useState('');
  const [badLink, setBadLink] = useState(false);
  const [ack, setAck] = useState(false);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'wrongPassword' | 'sessionUsed' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rekeyed = !!store.meta?.rekey;

  useEffect(() => () => store.closeEasySend(), [store.closeEasySend]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * A link from the camera or the paste box: on to the confirmation when it is one. A camera
   * frame with some other QR in it is simply not this one (the scan goes on); only a pasted
   * link that is not one says so.
   */
  const take = (text: string, typed = false): boolean => {
    const parsed = parseLink(text);
    if (!parsed) {
      if (typed) setBadLink(true);
      return false;
    }
    setBadLink(false);
    setLink(parsed);
    setAck(false);
    setProblem(null);
    store.goStep('confirm');
    return true;
  };

  const scanning = !rekeyed && step === undefined;
  const { failure, retry } = useQrScanner(videoRef, take, scanning);

  // The other device took it: the code step turns into the done state.
  const waiting = step === 'code' && s?.status === 'offered';
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void store.pollEasySend(), EASY_RECOVERY_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const send = async (unlock: { password: string } | 'passkey') => {
    if (!link || busy) return;
    setBusy(true);
    setProblem(null);
    const res = await store.offerEasyRecovery(link, unlock);
    setBusy(false);
    if (res === 'offered') {
      setPwd('');
      store.goStep('code');
    } else if (res === 'locked') setProblem('wrongPassword');
    else if (res === 'ended') setProblem('sessionUsed');
  };

  if (step === 'code' && s) {
    const done = s.status === 'claimed';
    return (
      <div className="scr screen col">
        <ScreenHeader
          title={done ? t('easyRecovery.sentTitle') : t('easyRecovery.showTitle')}
          desc={done ? t('easyRecovery.sentMsg') : t('easyRecovery.expiresIn', { time: countdown(s.expiresAt, now) })}
          onBack={store.goBack}
        />
        {done ? (
          <div className="easy-send-done">
            <CheckIcon className="easy-send-done-mark" />
          </div>
        ) : s.status === 'ended' ? (
          <Notice tone="danger">{t('easyRecovery.expired')}</Notice>
        ) : (
          <>
            <div className="easy-send-code" aria-label={s.code.split('').join(' ')}>
              {s.code.split('').map((d, i) => (
                <span key={i} className="easy-send-digit">
                  {d}
                </span>
              ))}
            </div>
            <Notice tone="danger" className="easy-send-notice">
              {t('easyRecovery.showNever')}
            </Notice>
            <div className="row g10 easy-send-waiting" role="status">
              <Spinner tone="text" />
              <span className="f1 min0">{t('easyRecovery.waiting')}</span>
            </div>
          </>
        )}
        <div className="spacer" />
        {(done || s.status === 'ended') && (
          <div className="kb-dock">
            <PrimaryButton onClick={() => store.backTo('settings')}>{t('common.done')}</PrimaryButton>
          </div>
        )}
      </div>
    );
  }

  if (step === 'confirm' && link) {
    const name = store.meta?.name || 'Cosmos Wallet';
    return (
      <div className="scr screen col">
        <ScreenHeader title={t('easyRecovery.confirmTitle')} desc={t('easyRecovery.confirmDesc', { name })} onBack={store.goBack} />
        <Notice tone="danger" className="easy-send-notice">
          {t('easyRecovery.confirmWarn')}
        </Notice>
        <CheckRow on={ack} onToggle={() => setAck((a) => !a)} className="easy-send-ack">
          {t('easyRecovery.confirmAck')}
        </CheckRow>
        {!store.passkeyUnlock && (
          <Field password label={t('pwd.label')} value={pwd} onChange={setPwd} />
        )}
        {problem && (
          <Notice tone="danger" className="easy-send-notice">
            {problem === 'wrongPassword' ? t('easyRecovery.wrongPassword') : t('easyRecovery.sessionUsed')}
          </Notice>
        )}
        <div className="spacer" />
        <div className="kb-dock">
          {problem === 'sessionUsed' ? (
            <GhostButton onClick={store.goBack}>{t('easyRecovery.newQr')}</GhostButton>
          ) : store.passkeyUnlock ? (
            <PasskeyButton label={t('easyRecovery.sendPasskey')} busy={busy} disabled={!ack} onClick={() => void send('passkey')} />
          ) : (
            <PrimaryButton disabled={!ack || !pwd || busy} onClick={() => void send({ password: pwd })}>
              {busy ? <Spinner /> : t('easyRecovery.send')}
            </PrimaryButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('easyRecovery.sendTitle')} desc={t('easyRecovery.sendDesc')} onBack={store.goBack} />
      {rekeyed ? (
        <Notice tone="danger">{t('easyRecovery.rekeyed')}</Notice>
      ) : (
        <>
          <div className="easy-send-viewport">
            {failure ? (
              <div className="col g12 easy-send-camera-off">
                <span>{t(cameraFailureKey(failure))}</span>
                <GhostButton onClick={retry}>{t('scan.retry')}</GhostButton>
              </div>
            ) : (
              <video ref={videoRef} className="easy-send-video" muted playsInline />
            )}
          </div>
          <label className="field easy-send-paste">
            <div className="field-label">{t('easyRecovery.pasteLabel')}</div>
            <input
              value={pasted}
              onChange={(e) => {
                setPasted((e.target as HTMLInputElement).value);
                setBadLink(false);
              }}
              placeholder="cosmos-easy-recovery:v1?…"
              autoComplete="off"
              spellCheck={false}
              className="input"
            />
          </label>
          {badLink && (
            <Notice tone="danger" className="easy-send-notice">
              {t('easyRecovery.notALink')}
            </Notice>
          )}
          <div className="spacer" />
          <div className="kb-dock">
            <PrimaryButton disabled={!pasted.trim()} onClick={() => take(pasted, true)}>
              {t('easyRecovery.useLink')}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
