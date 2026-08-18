import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { useCopied } from '@/hooks/useCopied';
import { trim } from '@/lib/format';
import type { PayIntent } from '@/lib/cosmospay';
import { AssetSelect } from '@/features/money/AssetSelect';
import { isNativeRef, XLM, type AssetRef } from '@/lib/asset';
import { sanitizeDecimalInput } from '@/lib/amount';
import { clampMemoText } from '@/lib/memo';
import { sendableAssets } from '@/lib/balances';
import '@/styles/features/money/pay-link.css';

/* ----------------------------- PAY LINK ----------------------------- */
/** Create a shareable CosmosPay pay link (SEP-7 pay request) to send to a friend. */
export function PayLink({ store }: { store: WalletStore }) {
  const t = store.t;
  const assets = sendableAssets(store.account);
  // Full (code, issuer) ref: the generated pay link embeds the issuer, so picking
  // it by code alone could publish a request for a look-alike token.
  const [assetRef, setAssetRef] = useState<AssetRef>(XLM);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [intent, setIntent] = useState<PayIntent | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, copy] = useCopied();

  const generate = async () => {
    setLoading(true);
    const res = await store.createPayLink({
      amount: amount.trim() || undefined,
      assetCode: isNativeRef(assetRef) ? undefined : assetRef.code,
      assetIssuer: assetRef.issuer ?? undefined,
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
    await copy(intent.uri);
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('paylink.title')} onBack={() => (intent ? setIntent(null) : store.goBack())} />
      {!intent ? (
        <>
          <div className="paylink-desc">{t('paylink.desc')}</div>
          <div className="glass card">
            <div className="paylink-amount-label">{t('paylink.amount')}</div>
            <div className="row between g10">
              <AssetSelect assets={assets} value={assetRef} onPick={(a) => setAssetRef({ code: a.code, issuer: a.issuer })} />
              <input value={amount} onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setAmount(v); }} inputMode="decimal" placeholder="0" className="paylink-amount-input" />
            </div>
          </div>
          <input value={msg} onChange={(e) => setMsg(clampMemoText((e.target as HTMLInputElement).value))} placeholder={t('paylink.msgPlaceholder')} className="input paylink-msg" />
          <div className="spacer" />
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
