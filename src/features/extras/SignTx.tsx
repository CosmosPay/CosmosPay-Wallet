import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { copyText, readText } from '@/lib/clipboard';
import { inspectXdr, submitXdr, type TxSummary } from '@/lib/stellar';
import '@/styles/features/extras/sign-tx.css';
import { cx } from '@/lib/cx';

/* --------------------------- SIGN TRANSACTION ----------------------- */
export function SignTx({ store }: { store: WalletStore }) {
  const t = store.t;
  const [xdr, setXdr] = useState('');
  const [summary, setSummary] = useState<TxSummary | null>(null);
  const [signed, setSigned] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onXdr = (v: string) => {
    setXdr(v);
    setErr('');
    setSigned('');
    const trimmed = v.trim();
    if (!trimmed) {
      setSummary(null);
      return;
    }
    try {
      setSummary(inspectXdr(store.network, trimmed));
    } catch {
      setSummary(null);
    }
  };

  const paste = async () => onXdr((await readText())?.trim() ?? '');

  const sign = async () => {
    if (!store.hasSession) return;
    setErr('');
    try {
      // The store owns the key: this screen asks for a signature and gets a result,
      // it is never handed the secret. Password gating + the source check live there.
      const result = await store.signRawXdr(xdr);
      if (result) setSigned(result);
    } catch (e) {
      setErr((e as Error).message || t('sign.invalid'));
    }
  };

  const submit = async () => {
    const okSig = await store.requestSignature({ title: t('confirmSig.submitTitle'), message: t('confirmSig.submitMsg') });
    if (!okSig) return;
    setBusy(true);
    setErr('');
    try {
      const { hash } = await submitXdr(store.network, (signed || xdr).trim());
      store.setSuccessInfo({ kind: 'ok', title: t('sign.submitted'), msg: '', rows: [], hash });
      store.setScreen('success');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copySigned = async () => {
    await copyText(signed);
    store.flash(t('common.copied'), 'ok');
  };

  return (
    <div className="scr screen col">
      <BackBar title={t('sign.title')} onBack={store.goBack} />
      <div className="sign-tx-desc">{t('sign.desc')}</div>

      <textarea
        value={xdr}
        onChange={(e) => onXdr((e.target as HTMLTextAreaElement).value)}
        placeholder="AAAAAgAAAAB…"
        rows={4}
        className="glass sign-tx-xdr"
      />
      <button onClick={paste} className="glass-soft sign-tx-paste">
        {t('sign.paste')}
      </button>

      {summary && (
        <div className="glass sign-tx-summary">
          {[
            [t('sign.source'), summary.source ? `${summary.source.slice(0, 6)}…${summary.source.slice(-6)}` : '—'],
            [t('sign.fee'), `${summary.fee} stroops`],
            [t('sign.ops'), summary.operations.join(', ') || '—'],
            [t('sign.memo'), summary.memo || '—'],
            [t('sign.signatures'), String(summary.signatures)],
          ].map((r) => (
            <div key={r[0]} className="flexr between g12 sign-tx-summary-row">
              <span className="t-muted-13">{r[0]}</span>
              <span className={cx('sign-tx-summary-val', r[0] === t('sign.source') && 'is-mono')}>{r[1]}</span>
            </div>
          ))}
        </div>
      )}

      {signed && (
        <div className="glass sign-tx-signed">
          <div className="sign-tx-signed-label">{t('sign.signedLabel')}</div>
          <div className="sign-tx-signed-xdr">{signed}</div>
          <button onClick={copySigned} className="glass-soft sign-tx-copy">{t('common.copy')}</button>
        </div>
      )}

      {err && <div className="sign-tx-err">{err}</div>}

      <div className="f1" />
      <div className="col g10 kb-dock">
        {!signed ? (
          <PrimaryButton disabled={!summary} onClick={sign}>{t('sign.sign')}</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy} onClick={submit}>{busy ? <Spinner /> : t('sign.submit')}</PrimaryButton>
        )}
      </div>
    </div>
  );
}
