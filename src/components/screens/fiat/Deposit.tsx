import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, GhostButton, BackBar, Spinner } from '@/components/parts';
import { railCurrency, PAY_METHODS } from '@/constants/fiat';
import type { FiatToken, Payin, PayinMethod, PayinQuote, PayinQuoteInput } from '@/lib/cosmospay';
import { fmtMinor, fmtFiat, toMinor, stableTokens } from '@/lib/fiatFormat';
import { Field, Select, QuoteRow } from '@/components/molecules/fiat';
import { DepositInstructions } from '@/components/organisms/fiat/DepositInstructions';
import '@/styles/screens/fiat/deposit.css';

/** Deposit fiat → crypto. Quote → create payin → show the payer's funding instructions. */
export function Deposit({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;
  const tokens = stableTokens(store); // a trusted stablecoin is needed to receive the mint
  const [token, setToken] = useState<FiatToken>((tokens[0]?.code as FiatToken) ?? 'USDC');
  const [method, setMethod] = useState<PayinMethod>('pix');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<PayinQuote | null>(null);
  const [payin, setPayin] = useState<Payin | null>(null);

  const cfg = PAY_METHODS.find((m) => m.method === method) ?? PAY_METHODS[0];
  const payerOk = (cfg.payer ?? []).every((f) => (f.options ? true : (payer[f.k] ?? '').trim()));
  const canQuote = !!receiverId && !!token && toMinor(amount) >= 1 && payerOk && !store.busy;

  const setP = (k: string, v: string) => setPayer((s) => ({ ...s, [k]: v }));
  const changeMethod = (m: string) => { setMethod(m as PayinMethod); setPayer({}); setQuote(null); };

  const buildPayerRules = () => {
    if (!cfg.payer?.length) return undefined;
    const r: Record<string, unknown> = {};
    for (const f of cfg.payer) {
      const v = f.options ? payer[f.k] ?? f.options[0] : (payer[f.k] ?? '').trim();
      if (v) r[f.k] = v;
    }
    return r;
  };

  const getQuote = async () => {
    if (!receiverId) return;
    const bwId = await store.ensureBlockchainWallet(receiverId); // blockchain_wallet_id (registers if needed)
    if (!bwId) return;
    const q = await store.quoteDeposit({
      blockchain_wallet_id: bwId,
      currency_type: 'sender',
      payment_method: method,
      token,
      request_amount: toMinor(amount),
      payer_rules: buildPayerRules() as PayinQuoteInput['payer_rules'],
    });
    if (q) setQuote(q);
  };

  const confirm = async () => {
    if (!quote) return;
    const p = await store.confirmDeposit(quote.id);
    if (p) setPayin(p);
  };

  if (payin) return <DepositInstructions store={store} payin={payin} onDone={() => store.setScreen('fiat')} />;

  if (!tokens.length) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
        <div className="glass fiat-note-card fiat-note-card-gap">{t('fiat.noTrustedToken')}</div>
        <PrimaryButton onClick={() => store.setScreen('add-asset')}>{t('fiat.addTrustline')}</PrimaryButton>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
      <div className="fiat-desc deposit-desc">{t('fiat.depositDesc')}</div>

      <Select label={t('fiat.method')} value={method} onChange={changeMethod}>
        {PAY_METHODS.map((m) => <option key={m.method} value={m.method}>{m.label}</option>)}
      </Select>
      <Select label={t('fiat.token')} value={token} onChange={(v) => { setToken(v as FiatToken); setQuote(null); }}>
        {tokens.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
      </Select>
      <Field label={t('fiat.payAmount')} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} placeholder="0.00" />
      {(cfg.payer ?? []).map((f) =>
        f.options ? (
          <Select key={f.k} label={f.label} value={payer[f.k] ?? f.options[0]} onChange={(v) => setP(f.k, v)}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Field key={f.k} label={f.label} value={payer[f.k] ?? ''} onChange={(v) => setP(f.k, v)} />
        ),
      )}

      {quote && (
        <div className="glass fiat-quote-card">
          <QuoteRow label={t('fiat.youPay')} val={`${fmtFiat(quote.sender_amount)}${railCurrency(method) ? ` ${railCurrency(method)}` : ''}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtMinor(quote.receiver_amount)} ${token}`} last />
        </div>
      )}

      <div className="fiat-spacer" />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmDeposit')}</PrimaryButton>
          <div className="fiat-gap-8" />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
      )}
      <div className="fiat-footnote">{t('fiat.quoteNote')}</div>
    </div>
  );
}
