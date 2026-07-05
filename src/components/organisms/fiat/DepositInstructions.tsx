import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import type { Payin } from '@/lib/cosmospay';
import '@/styles/screens/fiat/deposit.css';

/** Funding instructions for a created payin (PIX code, CLABE, CBU, memo + bank details, PSE link). */
export function DepositInstructions({ store, payin, onDone }: { store: WalletStore; payin: Payin; onDone: () => void }) {
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
    <div className="scr screen col pb-104">
      <BackBar title={t('fiat.depositInstructions')} onBack={onDone} />
      <div className="fiat-desc deposit-desc">{t('fiat.depositInstructionsDesc')}</div>
      <div className="glass row between deposit-status-card">
        <span className="deposit-status-label">{t('fiat.status')}</span>
        <span className="deposit-status-val">{payin.status ?? '—'}</span>
      </div>
      {rows.length === 0 && !bank && (
        <div className="glass fiat-empty-card">{t('fiat.insPending')}</div>
      )}
      {rows.map((r) => (
        <div key={r.label} className="glass fiat-row-card">
          <div className="deposit-ins-label">{r.label}</div>
          <div className="row g10">
            <span className="f1 min0 deposit-ins-value">{r.value}</span>
            <button onClick={() => copy(r.value)} className="tap glass-soft shrink0 fiat-chip-btn deposit-copy-btn">{t('fiat.copy')}</button>
          </div>
        </div>
      ))}
      {bank && (
        <div className="glass fiat-row-card">
          <div className="deposit-bank-label">{t('fiat.ins.bankDetails')}</div>
          {Object.entries(bank).map(([k, v]) => (
            <div key={k} className="row between deposit-bank-row">
              <span className="deposit-bank-key">{k}</span>
              <span className="deposit-bank-val">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="fiat-spacer" />
      <PrimaryButton onClick={onDone}>{t('common.done')}</PrimaryButton>
    </div>
  );
}
