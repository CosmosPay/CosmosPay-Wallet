import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { copyText, readText } from '@/lib/clipboard';
import { inspectXdr, signXdr, submitXdr, type TxSummary } from '@/lib/stellar';
import '@/styles/screens/extras/sign-tx.css';

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
    if (!store.session) return;
    const okSig = await store.requestSignature({ title: t('confirmSig.signTitle'), message: t('confirmSig.signMsg') });
    if (!okSig) return;
    setErr('');
    try {
      setSigned(signXdr(store.network, store.session.secret, xdr.trim()));
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
      <BackBar title={t('sign.title')} onBack={() => store.setScreen('operations')} />
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
              <span className={r[0] === t('sign.source') ? 'sign-tx-summary-val is-mono' : 'sign-tx-summary-val'}>{r[1]}</span>
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
      <div className="col g10">
        {!signed ? (
          <PrimaryButton disabled={!summary} onClick={sign}>{t('sign.sign')}</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy} onClick={submit}>{busy ? <Spinner /> : t('sign.submit')}</PrimaryButton>
        )}
      </div>
    </div>
  );
}
