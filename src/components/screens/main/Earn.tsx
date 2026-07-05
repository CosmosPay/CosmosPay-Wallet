import type { WalletStore } from '@/components/store';
import { TokenAvatar, NavMenu } from '@/components/parts';
import { buildKind } from '@/lib/platform';
import { computePortfolio } from '@/lib/portfolio';
import { fmt } from '@/lib/format';
import { BackCircle } from './shared';
import '@/styles/screens/main/shared.css';
import '@/styles/screens/main/earn.css';

/* ------------------------------- EARN -------------------------------- */
export function Earn({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total } = computePortfolio(store.account, store.prices);
  return (
    <div className="scr screen pb-110">
      <div className="main-head">
        <span className="title-30">{t('earn.title')}</span>
        <div className="row g10">
          <div className="glass-soft circle-btn circle-34 main-help">?</div>
          {buildKind() === 'ext' && <BackCircle store={store} />}
          <NavMenu store={store} />
        </div>
      </div>
      <div className="glass earn-card">
        <div className="earn-label">{t('earn.totalAssets')}</div>
        <div className="earn-total">${fmt(total, 2)}</div>
        <div className="earn-net-label">{t('earn.network')}</div>
        <div className="earn-net-value">{store.network.label}</div>
      </div>

      <div className="title-20 earn-generate">{t('earn.generate')}</div>
      <div className="glass card earn-lp">
        <div className="row g12 earn-lp-head">
          <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={36} />
          <div>
            <div className="earn-lp-title">Liquidity Pools (AMM)</div>
            <div className="t-dim-12">{t('earn.lpSub')}</div>
          </div>
        </div>
        <div className="earn-lp-desc">
          {t('earn.lpDesc')}
        </div>
        <div className="earn-soon">{t('earn.soon')}</div>
      </div>
      <div className="earn-note">
        {t('earn.note')}
      </div>
    </div>
  );
}
