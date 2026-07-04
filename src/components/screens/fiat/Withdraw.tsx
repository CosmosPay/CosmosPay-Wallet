import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner } from '@/components/parts';
import { railLabel, railCurrency } from '@/constants/fiat';
import type { FiatToken, PayoutQuote } from '@/lib/cosmospay';
import { fmtMinor, fmtFiat, toMinor, stableTokens, Field, Select, SCR_STYLE, quoteCardStyle, QuoteRow } from './shared';

/** Withdraw crypto → fiat. Quote → authorize → sign locally → create payout. */
export function Withdraw({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;

  useEffect(() => {
    if (receiverId) store.loadBankAccounts(receiverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const accounts = store.bankAccounts;
  const tokens = stableTokens(store, true); // must hold the token to send it
  const [bankId, setBankId] = useState('');
  const [token, setToken] = useState<FiatToken>((tokens[0]?.code as FiatToken) ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [coverFees, setCoverFees] = useState(true);
  const [quote, setQuote] = useState<PayoutQuote | null>(null);

  useEffect(() => { if (!bankId && accounts[0]) setBankId(accounts[0].id); }, [accounts, bankId]);

  const account = accounts.find((a) => a.id === bankId) ?? null;
  const ccy = railCurrency(account?.rail ?? account?.type); // fiat currency for the amount suffix
  const bal = tokens.find((x) => x.code === token)?.balance ?? 0;
  const insufficient = (parseFloat(amount) || 0) > bal;
  const canQuote = !!bankId && !!token && toMinor(amount) >= 1 && !insufficient && !store.busy;

  const getQuote = async () => {
    const q = await store.quoteWithdraw({ bank_account_id: bankId, request_amount: toMinor(amount), token, cover_fees: coverFees });
    if (q) setQuote(q);
  };
  const confirm = async () => { if (quote) await store.confirmWithdraw(quote, token, ccy); };

  if (!accounts.length) {
    return (
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
        <div className="glass" style={{ borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>{t('fiat.needBankAccount')}</div>
        <PrimaryButton onClick={() => store.setScreen('bankaccount')}>{t('fiat.addAccount')}</PrimaryButton>
      </div>
    );
  }
  if (!tokens.length) {
    return (
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
        <div className="glass" style={{ borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5 }}>{t('fiat.noTokenBalance')}</div>
      </div>
    );
  }

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.withdrawDesc')}</div>

      <Select label={t('fiat.bankAccount')} value={bankId} onChange={(v) => { setBankId(v); setQuote(null); }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {railLabel(a.rail ?? a.type)}</option>)}
      </Select>
      <Select label={t('fiat.token')} value={token} onChange={(v) => { setToken(v as FiatToken); setQuote(null); }}>
        {tokens.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.balance.toFixed(2)}</option>)}
      </Select>
      <Field label={t('fiat.sendAmount')} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} placeholder="0.00" />
      <div style={{ fontSize: '11.5px', color: insufficient ? C.danger : C.dim, fontWeight: 700, margin: '-4px 2px 12px' }}>
        {t('fiat.balance')}: {bal.toFixed(2)} {token}
      </div>

      <div onClick={() => { setCoverFees((v) => !v); setQuote(null); }} className="tap glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '14px', padding: '14px 16px', marginBottom: '12px', cursor: 'pointer' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>{t('fiat.coverFees')}</span>
        <span style={{ width: '44px', height: '26px', borderRadius: '999px', background: coverFees ? C.accent : 'var(--surface)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: '3px', left: coverFees ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
        </span>
      </div>

      {quote && (
        <div style={quoteCardStyle}>
          <QuoteRow label={t('fiat.youSend')} val={`${fmtMinor(quote.sender_amount)} ${token}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtFiat(quote.receiver_local_amount || quote.receiver_amount)}${ccy ? ` ${ccy}` : ''}`} last />
        </div>
      )}

      <div style={{ flex: 1, minHeight: '12px' }} />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmWithdraw')}</PrimaryButton>
          <div style={{ height: '8px' }} />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
      )}
      <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, textAlign: 'center', marginTop: '10px', lineHeight: 1.5 }}>{t('fiat.withdrawSignNote')}</div>
    </div>
  );
}
