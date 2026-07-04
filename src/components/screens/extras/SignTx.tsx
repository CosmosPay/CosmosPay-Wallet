import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { copyText, readText } from '@/lib/clipboard';
import { inspectXdr, signXdr, submitXdr, type TxSummary } from '@/lib/stellar';

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
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 16px' }}>{t('sign.desc')}</div>

      <textarea
        value={xdr}
        onChange={(e) => onXdr((e.target as HTMLTextAreaElement).value)}
        placeholder="AAAAAgAAAAB…"
        rows={4}
        className="glass" style={{ width: '100%', borderRadius: '18px', padding: '14px 16px', color: 'var(--text)', fontSize: '12.5px', fontWeight: 600, resize: 'none', outline: 'none', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: '10px' }}
      />
      <button onClick={paste} className="glass-soft" style={{ alignSelf: 'flex-start', height: '40px', color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '0 18px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', marginBottom: '16px' }}>
        {t('sign.paste')}
      </button>

      {summary && (
        <div className="glass" style={{ borderRadius: '18px', padding: '6px 16px', marginBottom: '16px' }}>
          {[
            [t('sign.source'), summary.source ? `${summary.source.slice(0, 6)}…${summary.source.slice(-6)}` : '—'],
            [t('sign.fee'), `${summary.fee} stroops`],
            [t('sign.ops'), summary.operations.join(', ') || '—'],
            [t('sign.memo'), summary.memo || '—'],
            [t('sign.signatures'), String(summary.signatures)],
          ].map((r, i, arr) => (
            <div key={r[0]} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <span style={{ color: C.muted, fontSize: '13px', fontWeight: 600 }}>{r[0]}</span>
              <span style={{ fontSize: '13px', fontWeight: 700, textAlign: 'right', wordBreak: 'break-word', fontFamily: r[0] === t('sign.source') ? 'monospace' : 'inherit' }}>{r[1]}</span>
            </div>
          ))}
        </div>
      )}

      {signed && (
        <div className="glass" style={{ borderRadius: '18px', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: C.accent, fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('sign.signedLabel')}</div>
          <div style={{ fontSize: '11.5px', fontWeight: 600, wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5, color: C.muted, marginBottom: '12px' }}>{signed}</div>
          <button onClick={copySigned} className="glass-soft" style={{ width: '100%', height: '44px', color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.copy')}</button>
        </div>
      )}

      {err && <div style={{ fontSize: '12.5px', fontWeight: 700, color: C.danger, marginBottom: '12px', lineHeight: 1.5 }}>{err}</div>}

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {!signed ? (
          <PrimaryButton disabled={!summary} onClick={sign}>{t('sign.sign')}</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy} onClick={submit}>{busy ? <Spinner /> : t('sign.submit')}</PrimaryButton>
        )}
      </div>
    </div>
  );
}
