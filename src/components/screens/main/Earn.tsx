import type { WalletStore } from '@/components/store';
import { C, TokenAvatar, NavMenu } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { computePortfolio } from '@/lib/portfolio';
import { fmt } from '@/lib/format';
import { BackCircle } from './shared';

/* ------------------------------- EARN -------------------------------- */
export function Earn({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total } = computePortfolio(store.account, store.prices);
  return (
    <div className="scr screen pb-110">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 18px' }}>
        <span className="title-30">{t('earn.title')}</span>
        <div className="row g10">
          <div className="glass-soft" style={{ width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: C.muted }}>?</div>
          {buildKind() === 'ext' && <BackCircle store={store} />}
          <NavMenu store={store} />
        </div>
      </div>
      <div className="glass" style={{ position: 'relative', borderRadius: '22px', background: 'linear-gradient(135deg, rgba(255,255,255,.12), rgba(18,18,18,.35))', padding: '20px', overflow: 'hidden', marginBottom: '26px' }}>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '6px' }}>{t('earn.totalAssets')}</div>
        <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>${fmt(total, 2)}</div>
        <div style={{ marginTop: '14px', fontSize: '13px', color: C.muted, fontWeight: 600 }}>{t('earn.network')}</div>
        <div style={{ fontSize: '16px', color: C.accent, fontWeight: 800, marginTop: '2px' }}>{store.network.label}</div>
      </div>

      <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-.4px', marginBottom: '14px' }}>{t('earn.generate')}</div>
      <div className="glass card" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={36} />
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>Liquidity Pools (AMM)</div>
            <div className="t-dim-12">{t('earn.lpSub')}</div>
          </div>
        </div>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
          {t('earn.lpDesc')}
        </div>
        <div style={{ display: 'inline-block', marginTop: '12px', fontSize: '12px', fontWeight: 800, color: 'var(--on-accent)', background: C.accent, padding: '5px 11px', borderRadius: '9px' }}>{t('earn.soon')}</div>
      </div>
      <div style={{ fontSize: '12.5px', color: C.dim, fontWeight: 600, lineHeight: 1.5, padding: '4px 4px' }}>
        {t('earn.note')}
      </div>
    </div>
  );
}
