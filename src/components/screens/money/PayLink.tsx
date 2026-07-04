import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner, inputStyle } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import { trim } from '@/lib/format';
import type { PayIntent } from '@/lib/cosmospay';
import { sendableAssets, SwapTokenSelect } from './shared';

/* ----------------------------- PAY LINK ----------------------------- */
/** Create a shareable CosmosPay pay link (SEP-7 pay request) to send to a friend. */
export function PayLink({ store }: { store: WalletStore }) {
  const t = store.t;
  const assets = sendableAssets(store);
  const [code, setCode] = useState('XLM');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [intent, setIntent] = useState<PayIntent | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const asset = assets.find((a) => a.code === code);

  const generate = async () => {
    setLoading(true);
    const res = await store.createPayLink({
      amount: amount.trim() || undefined,
      assetCode: code === 'XLM' ? undefined : code,
      assetIssuer: asset && !asset.isNative ? asset.issuer ?? undefined : undefined,
      msg: msg.trim() || undefined,
    });
    setLoading(false);
    if (res) setIntent(res);
  };

  const share = async () => {
    if (!intent) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: intent.uri });
        return;
      }
    } catch {
      /* fall back to copy */
    }
    await copyText(intent.uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('paylink.title')} onBack={() => (intent ? setIntent(null) : store.setScreen('receive'))} />
      {!intent ? (
        <>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '4px 2px 14px' }}>{t('paylink.desc')}</div>
          <div className="glass card">
            <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('paylink.amount')}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <SwapTokenSelect assets={assets} code={code} onPick={setCode} />
              <input value={amount} onChange={(e) => setAmount((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', textAlign: 'right', color: 'var(--text)', fontSize: '28px', fontWeight: 800, outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>
          <input value={msg} onChange={(e) => setMsg((e.target as HTMLInputElement).value.slice(0, 28))} placeholder={t('paylink.msgPlaceholder')} style={{ ...inputStyle, background: C.cardSolid, border: '1px solid var(--glass-border)', marginTop: '12px' }} />
          <div style={{ flex: 1, minHeight: '14px' }} />
          <PrimaryButton disabled={loading} onClick={generate}>{loading ? <Spinner /> : t('paylink.cta')}</PrimaryButton>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', marginTop: '8px' }}>
          <img src={intent.qr} alt="" style={{ width: '230px', height: '230px', borderRadius: '20px', background: '#fff', padding: '10px' }} />
          <div style={{ fontSize: '20px', fontWeight: 800 }}>
            {intent.amount ? `${trim(parseFloat(intent.amount), 4)} ${intent.asset === 'native' ? 'XLM' : intent.asset}` : t('paylink.anyAmount')}
          </div>
          {intent.msg && <div className="t-muted-13">{intent.msg}</div>}
          <div className="glass-soft" style={{ borderRadius: '14px', padding: '12px 14px', fontSize: '11.5px', color: C.muted, fontWeight: 600, wordBreak: 'break-all', width: '100%', textAlign: 'center' }}>{intent.uri}</div>
          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <GhostButton onClick={() => setIntent(null)} style={{ flex: 1 }}>{t('paylink.another')}</GhostButton>
            <PrimaryButton onClick={share} style={{ flex: 1 }}>{copied ? t('common.copied') : t('paylink.share')}</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
