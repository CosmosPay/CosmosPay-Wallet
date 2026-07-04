import type { WalletStore } from '@/components/store';
import { C, PrimaryButton } from '@/components/parts';
import { explorerTxUrl } from '@/lib/stellar';

/* ----------------------------- SUCCESS ------------------------------ */
export function Success({ store }: { store: WalletStore }) {
  const t = store.t;
  const si = store.successInfo;
  const isErr = si?.kind === 'err';
  const ringColor = isErr ? '#ff5d5d' : '#23c552'; // red on failure, green on success
  const goHome = () => {
    store.setSuccessInfo(null);
    if (store.session) store.go('home', 'home');
    else store.setScreen('unlock');
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 20px 24px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: '96px', height: '96px', marginBottom: '26px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ringColor, animation: 'ring 1.6s ease-out infinite' }} />
          <div style={{ position: 'relative', width: '96px', height: '96px', borderRadius: '50%', background: ringColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .5s ease', boxShadow: `0 12px 34px ${ringColor}55` }}>
            {isErr ? (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            ) : (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
        </div>
        <div style={{ fontSize: '26px', fontWeight: 800, marginBottom: '10px' }}>{si?.title ?? 'Listo'}</div>
        <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, maxWidth: '270px' }}>{si?.msg ?? ''}</div>
      </div>
      {si?.rows?.length ? (
        <div className="glass" style={{ borderRadius: '18px', padding: '6px 18px', marginBottom: '14px' }}>
          {si.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 0', borderBottom: i < si.rows.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <span style={{ color: C.muted, fontSize: '14px', fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: '14.5px', fontWeight: 700 }}>{r.val}</span>
            </div>
          ))}
        </div>
      ) : null}
      {si?.hash && (
        <a href={explorerTxUrl(store.network, si.hash)} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: 700, padding: '10px', textDecoration: 'none', marginBottom: '4px' }}>
          {t('success.viewTx')}
        </a>
      )}
      <PrimaryButton onClick={goHome}>{store.session ? t('success.viewWallet') : t('common.continue')}</PrimaryButton>
    </div>
  );
}
