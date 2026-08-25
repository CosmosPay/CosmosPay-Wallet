import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { railLabel, railCurrency } from '@/lib/fiatRails';
import type { FiatToken, PayoutQuote } from '@/lib/cosmospay';
import { fmtMinor, fmtFiat, toMinor, stableTokens } from '@/features/fiat/format';
import { QuoteRow } from '@/features/fiat/QuoteRow';
import { Select } from '@/features/fiat/Select';
import { Field } from '@/ui/Field';
import '@/styles/features/fiat/withdraw.css';
import { cx } from '@/lib/cx';

/** Withdraw crypto → fiat. Quote → authorize → sign locally → create payout. */
export function Withdraw({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;

  useEffect(() => {
    if (receiverId) store.loadBankAccounts(receiverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const accounts = store.bankAccounts;
  const tokens = stableTokens(store.account?.balances, true); // must hold the token to send it
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
      <div className="scr screen col pb-104">
        <BackBar title={t('fiat.withdrawTitle')} onBack={store.goBack} />
        <div className="glass fiat-note-card fiat-note-card-gap">{t('fiat.needBankAccount')}</div>
        <PrimaryButton onClick={() => store.setScreen('bankaccount')}>{t('fiat.addAccount')}</PrimaryButton>
      </div>
    );
  }
  if (!tokens.length) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={t('fiat.withdrawTitle')} onBack={store.goBack} />
        <div className="glass fiat-note-card">{t('fiat.noTokenBalance')}</div>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('fiat.withdrawTitle')} onBack={store.goBack} />
      <div className="desc withdraw-desc">{t('fiat.withdrawDesc')}</div>

      <Select label={t('fiat.bankAccount')} value={bankId} onChange={(v) => { setBankId(v); setQuote(null); }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {railLabel(a.rail ?? a.type)}</option>)}
      </Select>
      <Select label={t('fiat.token')} value={token} onChange={(v) => { setToken(v as FiatToken); setQuote(null); }}>
        {tokens.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.balance.toFixed(2)}</option>)}
      </Select>
      <Field tone="soft" kind="amount" label={t('fiat.sendAmount')} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} placeholder="0.00" />
      <div className={cx('withdraw-balance', insufficient && 'is-insufficient')}>
        {t('fiat.balance')}: {bal.toFixed(2)} {token}
      </div>

      <div onClick={() => { setCoverFees((v) => !v); setQuote(null); }} className="tap glass row between withdraw-cover">
        <span className="withdraw-cover-label">{t('fiat.coverFees')}</span>
        <span className={cx('withdraw-switch', coverFees && 'is-on')}>
          <span className="withdraw-switch-knob" />
        </span>
      </div>

      {quote && (
        <div className="glass fiat-quote-card">
          <QuoteRow label={t('fiat.youSend')} val={`${fmtMinor(quote.sender_amount)} ${token}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtFiat(quote.receiver_local_amount || quote.receiver_amount)}${ccy ? ` ${ccy}` : ''}`} last />
        </div>
      )}

      <div className="spacer" />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmWithdraw')}</PrimaryButton>
          <div className="fiat-gap-8" />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <div className="kb-dock">
          <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
        </div>
      )}
      <div className="fiat-footnote">{t('fiat.withdrawSignNote')}</div>
    </div>
  );
}
