import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { TokenAvatar } from '@/ui/TokenAvatar';
import { buildKind } from '@/lib/platform';
import { computePortfolio } from '@/lib/portfolio';
import { fmt } from '@/lib/format';
import { openExternal } from '@/lib/openExternal';
import { BackCircle } from '@/features/wallet/BackCircle';
import '@/styles/features/wallet/tab-header.css';
import '@/styles/features/wallet/earn.css';

/* ------------------------------- EARN -------------------------------- */
export function Earn({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total } = computePortfolio(store.account, store.prices, store.network.id);
  const protocols = [
    {
      name: 'DeFindex',
      mark: 'D',
      kind: t('earn.defindexKind'),
      description: t('earn.defindexDesc'),
      url: 'https://app.defindex.io/',
      tone: 'defindex',
    },
    {
      name: 'Blend Protocol',
      mark: 'B',
      kind: t('earn.blendKind'),
      description: t('earn.blendDesc'),
      url: 'https://mainnet.blend.capital/',
      tone: 'blend',
    },
    {
      name: 'Etherfuse',
      mark: 'E',
      kind: t('earn.etherfuseKind'),
      description: t('earn.etherfuseDesc'),
      url: 'https://app.etherfuse.com/',
      tone: 'etherfuse',
    },
  ] as const;
  return (
    <div className="scr screen pb-110">
      <div className="main-head">
        <span className="title-30">{t('earn.title')}</span>
        <div className="row g10">
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
      <button type="button" className="glass card earn-option earn-lp tap" onClick={() => store.go('liquidity')}>
        <div className="row g12 earn-lp-head">
          <TokenAvatar glyph="◇" tone="pool" size={36} />
          <div className="earn-option-copy">
            <div className="earn-lp-title">Liquidity Pools (AMM)</div>
            <div className="t-dim-12">{t('earn.lpSub')}</div>
          </div>
          <span className="earn-option-arrow" aria-hidden="true">→</span>
        </div>
        <div className="earn-lp-desc">
          {t('earn.lpDesc')}
        </div>
        <div className="earn-lp-cta">{t('lp.open')} →</div>
      </button>

      <div className="earn-protocols" aria-label={t('earn.protocols')}>
        {protocols.map((protocol) => (
          <button
            type="button"
            className={`glass card earn-option earn-protocol tap earn-protocol-${protocol.tone}`}
            onClick={() => void openExternal(protocol.url)}
            key={protocol.name}
          >
            <div className="earn-protocol-head">
              <span className="earn-protocol-mark" aria-hidden="true">{protocol.mark}</span>
              <div className="earn-option-copy">
                <div className="earn-protocol-title-row">
                  <span className="earn-lp-title">{protocol.name}</span>
                  <span className="earn-protocol-kind">{protocol.kind}</span>
                </div>
                <div className="earn-lp-desc">{protocol.description}</div>
              </div>
              <span className="earn-option-arrow earn-option-arrow-external" aria-hidden="true">↗</span>
            </div>
            <div className="earn-protocol-cta">{t('earn.openProtocol')}</div>
          </button>
        ))}
      </div>
      <div className="earn-note">
        {t('earn.note')}
      </div>
    </div>
  );
}
