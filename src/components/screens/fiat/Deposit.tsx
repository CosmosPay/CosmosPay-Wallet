import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import { railCurrency, PAY_METHODS } from '@/constants/fiat';
import type { FiatToken, Payin, PayinMethod, PayinQuote, PayinQuoteInput } from '@/lib/cosmospay';
import { fmtMinor, fmtFiat, toMinor, stableTokens, Field, Select, SCR_STYLE, quoteCardStyle, QuoteRow } from './shared';

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
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
        <div className="glass" style={{ borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>{t('fiat.noTrustedToken')}</div>
        <PrimaryButton onClick={() => store.setScreen('add-asset')}>{t('fiat.addTrustline')}</PrimaryButton>
      </div>
    );
  }

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.depositDesc')}</div>

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
        <div style={quoteCardStyle}>
          <QuoteRow label={t('fiat.youPay')} val={`${fmtFiat(quote.sender_amount)}${railCurrency(method) ? ` ${railCurrency(method)}` : ''}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtMinor(quote.receiver_amount)} ${token}`} last />
        </div>
      )}

      <div style={{ flex: 1, minHeight: '12px' }} />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmDeposit')}</PrimaryButton>
          <div style={{ height: '8px' }} />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
      )}
      <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, textAlign: 'center', marginTop: '10px', lineHeight: 1.5 }}>{t('fiat.quoteNote')}</div>
    </div>
  );
}

/** Funding instructions for a created payin (PIX code, CLABE, CBU, memo + bank details, PSE link). */
function DepositInstructions({ store, payin, onDone }: { store: WalletStore; payin: Payin; onDone: () => void }) {
  const t = store.t;
  const ins = payin.instructions ?? {};
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => { if (typeof v === 'string' && v) rows.push({ label, value: v }); };
  push(t('fiat.ins.pixCode'), ins.pix_code);
  push(t('fiat.ins.clabe'), ins.clabe);
  push(t('fiat.ins.cbu'), ins.cbu);
  push(t('fiat.ins.memoCode'), ins.memo_code);
  push(t('fiat.ins.pseLink'), ins.pse_payment_link);
  const bank = ins.blindpay_bank_details && typeof ins.blindpay_bank_details === 'object' ? (ins.blindpay_bank_details as Record<string, unknown>) : null;

  const copy = async (v: string) => { await copyText(v); store.flash(t('fiat.copied'), 'ok'); };

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.depositInstructions')} onBack={onDone} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.depositInstructionsDesc')}</div>
      <div className="glass" style={{ borderRadius: '14px', padding: '12px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', color: C.muted, fontWeight: 700 }}>{t('fiat.status')}</span>
        <span style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase' }}>{payin.status ?? '—'}</span>
      </div>
      {rows.length === 0 && !bank && (
        <div className="glass" style={{ borderRadius: '16px', padding: '18px', fontSize: '12.5px', color: C.muted, fontWeight: 600, textAlign: 'center' }}>{t('fiat.insPending')}</div>
      )}
      {rows.map((r) => (
        <div key={r.label} className="glass" style={{ borderRadius: '14px', padding: '12px 14px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11.5px', color: C.muted, fontWeight: 700, marginBottom: '4px' }}>{r.label}</div>
          <div className="row g10">
            <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, wordBreak: 'break-all', fontFamily: 'monospace' }}>{r.value}</span>
            <button onClick={() => copy(r.value)} className="tap glass-soft" style={{ border: 'none', borderRadius: '999px', padding: '7px 12px', fontSize: '12px', fontWeight: 800, color: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}>{t('fiat.copy')}</button>
          </div>
        </div>
      ))}
      {bank && (
        <div className="glass" style={{ borderRadius: '14px', padding: '12px 14px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11.5px', color: C.muted, fontWeight: 700, marginBottom: '6px' }}>{t('fiat.ins.bankDetails')}</div>
          {Object.entries(bank).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0', fontSize: '12.5px' }}>
              <span style={{ color: C.dim, fontWeight: 600 }}>{k}</span>
              <span style={{ fontWeight: 700, wordBreak: 'break-all', textAlign: 'right' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: '12px' }} />
      <PrimaryButton onClick={onDone}>{t('common.done')}</PrimaryButton>
    </div>
  );
}
