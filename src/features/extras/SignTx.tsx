import { useId, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { copyText, readText } from '@/lib/clipboard';
import { BUILTIN_NETWORKS, inspectXdr, submitXdr, type TxSummary } from '@/lib/stellar';
import { Segmented } from '@/ui/Segmented';
import '@/styles/features/extras/sign-tx.css';
import { cx } from '@/lib/cx';

/* --------------------------- SIGN TRANSACTION ----------------------- */
export function SignTx({ store }: { store: WalletStore }) {
  const t = store.t;
  const fieldId = useId();
  const hintId = useId();
  const [xdr, setXdr] = useState('');
  const [summary, setSummary] = useState<TxSummary | null>(null);
  const [signed, setSigned] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The network the signature is for (store.signRawXdr): the wallet's own by default, or the one
  // the transaction was built for — a pasted XDR does not say which, and a signature made for
  // another network's passphrase is worthless there. Choosing it here moves nothing else.
  const [netId, setNetId] = useState(store.network.id);
  const netChoices = store.network.custom ? [...BUILTIN_NETWORKS, store.network] : BUILTIN_NETWORKS;
  const signNet = netChoices.find((n) => n.id === netId) ?? store.network;
  const pickNet = (id: string) => {
    setNetId(id);
    setSigned('');
    setErr('');
  };

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
      setSummary(inspectXdr(signNet, trimmed));
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
      const result = await store.signRawXdr(xdr, signNet.id);
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
      const { hash } = await submitXdr(signNet, (signed || xdr).trim());
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
    <div className="scr screen col sign-tx-screen">
      <ScreenHeader title={t('sign.title')} desc={t('sign.desc')} onBack={store.goBack} />

      <div className="sign-tx-field">
        <div className="sign-tx-field-head">
          <label htmlFor={fieldId} className="sign-tx-net-label">XDR</label>
          <button type="button" onClick={paste} className="sign-tx-paste">{t('sign.paste')}</button>
        </div>
      <textarea
        id={fieldId}
        value={xdr}
        onChange={(e) => onXdr((e.target as HTMLTextAreaElement).value)}
        placeholder="AAAAAgAAAAB…"
        rows={4}
        spellCheck={false}
        className="glass sign-tx-xdr"
      />
      </div>

      <div className="sign-tx-net" role="group" aria-label={t('sign.network')} aria-describedby={hintId}>
        <div className="sign-tx-net-label">{t('sign.network')}</div>
        <Segmented label={t('sign.network')} options={netChoices.map((n) => ({ value: n.id, label: n.label }))} value={signNet.id} onChange={pickNet} />
        <p id={hintId} className="sign-tx-net-hint">{t('sign.networkHint')}</p>
      </div>

      {summary && (
        <dl className="glass sign-tx-summary">
          {[
            [t('sign.source'), summary.source ? `${summary.source.slice(0, 6)}…${summary.source.slice(-6)}` : '—'],
            [t('sign.fee'), `${summary.fee} stroops`],
            [t('sign.ops'), summary.operations.join(', ') || '—'],
            [t('sign.memo'), summary.memo || '—'],
            [t('sign.signatures'), String(summary.signatures)],
          ].map((r) => (
            <div key={r[0]} className="flexr between g12 sign-tx-summary-row">
              <dt className="t-muted-13">{r[0]}</dt>
              <dd className={cx('sign-tx-summary-val', r[0] === t('sign.source') && 'is-mono')}>{r[1]}</dd>
            </div>
          ))}
        </dl>
      )}

      {signed && (
        <div className="glass sign-tx-signed">
          <div className="sign-tx-field-head">
            <h2 className="sign-tx-signed-label">{t('sign.signedLabel')}</h2>
            <button type="button" onClick={copySigned} className="sign-tx-copy">{t('common.copy')}</button>
          </div>
          <pre tabIndex={0} aria-label={t('sign.signedLabel')} className="sign-tx-signed-xdr"><code>{signed}</code></pre>
        </div>
      )}

      {err && <div role="alert" className="sign-tx-err">{err}</div>}

      <div className="col g10 kb-dock sign-tx-actions">
        {!signed ? (
          <PrimaryButton disabled={!summary} onClick={sign}>{t('sign.sign')}</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy} onClick={submit}>{busy ? <Spinner /> : t('sign.submit')}</PrimaryButton>
        )}
      </div>
    </div>
  );
}
