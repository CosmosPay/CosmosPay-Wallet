import type { WalletStore } from '@/components/store';
import { PrimaryButton } from '@/components/parts';
import { explorerTxUrl } from '@/lib/stellar';
import '@/styles/screens/money/success.css';

/* ----------------------------- SUCCESS ------------------------------ */
export function Success({ store }: { store: WalletStore }) {
  const t = store.t;
  const si = store.successInfo;
  const isErr = si?.kind === 'err';
  const v = isErr ? 'err' : 'ok'; // red on failure, green on success
  const goHome = () => {
    store.setSuccessInfo(null);
    if (store.session) store.go('home', 'home');
    else store.setScreen('unlock');
  };
  return (
    <div className="col success-screen">
      <div className="f1 col center success-hero">
        <div className="success-ring-wrap">
          <div className={`success-ring success-ring--${v}`} />
          <div className={`success-badge success-badge--${v}`}>
            {isErr ? (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            ) : (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
        </div>
        <div className="success-title">{si?.title ?? 'Listo'}</div>
        <div className="success-msg">{si?.msg ?? ''}</div>
      </div>
      {si?.rows?.length ? (
        <div className="glass success-rows">
          {si.rows.map((r, i) => (
            <div key={i} className="success-row">
              <span className="success-row-label">{r.label}</span>
              <span className="success-row-val">{r.val}</span>
            </div>
          ))}
        </div>
      ) : null}
      {si?.hash && (
        <a href={explorerTxUrl(store.network, si.hash)} target="_blank" rel="noreferrer" className="success-tx">
          {t('success.viewTx')}
        </a>
      )}
      <PrimaryButton onClick={goHome}>{store.session ? t('success.viewWallet') : t('common.continue')}</PrimaryButton>
    </div>
  );
}
