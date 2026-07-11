import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, GhostButton, BackBar, Spinner } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import { trim } from '@/lib/format';
import type { PayIntent } from '@/lib/cosmospay';
import { sendableAssets, SwapTokenSelect } from './shared';
import '@/styles/screens/money/pay-link.css';

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
          <div className="paylink-desc">{t('paylink.desc')}</div>
          <div className="glass card">
            <div className="paylink-amount-label">{t('paylink.amount')}</div>
            <div className="row between g10">
              <SwapTokenSelect assets={assets} code={code} onPick={setCode} />
              <input value={amount} onChange={(e) => setAmount((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" className="paylink-amount-input" />
            </div>
          </div>
          <input value={msg} onChange={(e) => setMsg((e.target as HTMLInputElement).value.slice(0, 28))} placeholder={t('paylink.msgPlaceholder')} className="input paylink-msg" />
          <div className="paylink-spacer" />
          <PrimaryButton disabled={loading} onClick={generate}>{loading ? <Spinner /> : t('paylink.cta')}</PrimaryButton>
        </>
      ) : (
        <div className="col center g14 paylink-result">
          <img src={intent.qr} alt="" className="paylink-qr" />
          <div className="paylink-result-amount">
            {intent.amount ? `${trim(parseFloat(intent.amount), 4)} ${intent.asset === 'native' ? 'XLM' : intent.asset}` : t('paylink.anyAmount')}
          </div>
          {intent.msg && <div className="t-muted-13">{intent.msg}</div>}
          <div className="glass-soft paylink-uri">{intent.uri}</div>
          <div className="flexr g10 paylink-actions">
            <GhostButton onClick={() => setIntent(null)} className="f1">{t('paylink.another')}</GhostButton>
            <PrimaryButton onClick={share} className="f1">{copied ? t('common.copied') : t('paylink.share')}</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
