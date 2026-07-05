import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar } from '@/components/parts';
import { OpCard } from '@/components/molecules/fiat/OpCard';
import { railLabel } from '@/constants/fiat';
import '@/styles/screens/fiat/fiat.css';

/** Map BlindPay's raw KYC status (+ the `disabled` flag) to a friendly label + state key. */
function kycStatus(store: WalletStore, raw?: string | null, disabled?: boolean): { label: string; state: 'approved' | 'rejected' | 'pending'; approved: boolean } {
  const s = (raw || 'pending').toLowerCase();
  // A receiver only counts as approved if it's verified AND not disabled.
  const approved = !disabled && /approv|verified|active|complete|success/.test(s);
  const rejected = disabled === true || /reject|denied|fail|declin/.test(s);
  const state = approved ? 'approved' : rejected ? 'rejected' : 'pending';
  return {
    label: approved ? store.t('fiat.statusApproved') : rejected ? store.t('fiat.statusRejected') : store.t('fiat.statusPending'),
    state,
    approved,
  };
}

/** Once a default receiver exists: KYC status + deposit/withdraw ops + deposit accounts. */
export function ReceiverHub({ store, receiverId }: { store: WalletStore; receiverId: string }) {
  const t = store.t;
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // account id pending delete-confirm

  useEffect(() => {
    store.loadReceiver(receiverId); // refreshes the real KYC status from BlindPay
    store.loadBankAccounts(receiverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const receiver = store.receivers.find((r) => r.id === receiverId) ?? null;
  const st = kycStatus(store, receiver?.kycStatus ?? receiver?.kyc_status ?? receiver?.status, receiver?.disabled);

  return (
    <>
      <BackBar title={t('fiat.title')} onBack={() => store.go('home', 'home')} />
      <div className="glass card fiat-account-card">
        <div className="fiat-account-label">{t('fiat.account')}</div>
        <div className="row between">
          <span className="fiat-account-id">{receiverId.slice(0, 10)}…</span>
          <span className={`fiat-status-pill fiat-status-pill--${st.state}`}>{st.label}</span>
        </div>
      </div>
      <OpCard
        icon={<path d="M12 4v13M6 11l6 6 6-6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        title={t('fiat.onramp')} desc={t('fiat.onrampDesc')}
        onClick={() => (st.approved ? store.setScreen('deposit') : store.flash(t('fiat.needApproved'), 'info'))}
      />
      <OpCard
        icon={<path d="M12 4v13M6 10l6-6 6 6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        title={t('fiat.offramp')} desc={t('fiat.offrampDesc')}
        onClick={() => (st.approved ? store.setScreen('withdraw') : store.flash(t('fiat.needApproved'), 'info'))}
      />

      {/* Deposit/payout accounts (per currency / rail). */}
      <div className="row between fiat-accounts-head">
        <span className="fiat-title-15">{t('fiat.accounts')}</span>
        <span onClick={() => store.setScreen('bankaccount')} className="fiat-add-link">+ {t('fiat.addAccount')}</span>
      </div>
      {store.bankAccounts.length === 0 ? (
        <div className="glass fiat-empty-card">{t('fiat.noAccounts')}</div>
      ) : (
        store.bankAccounts.map((a) => {
          const confirming = confirmDel === a.id;
          return (
            <div key={a.id} className="glass row between g12 fiat-row-card">
              <div className="f1 min0">
                <div className="fiat-bank-name">{a.name}</div>
                <div className="fiat-bank-rail">{railLabel(a.rail ?? a.type)}</div>
              </div>
              {confirming ? (
                <div className="row g8 shrink0">
                  <button
                    onClick={() => { setConfirmDel(null); store.removeFiatBankAccount(receiverId, a.id); }}
                    disabled={store.busy}
                    className="fiat-chip-btn fiat-chip-del"
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    onClick={() => setConfirmDel(null)}
                    className="glass-soft fiat-chip-btn fiat-chip-cancel"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(a.id)}
                  aria-label={t('fiat.deleteAccount')}
                  className="glass-soft center shrink0 fiat-trash-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
