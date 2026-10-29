import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { TokenAvatar } from '@/ui/TokenAvatar';
import { buildKind } from '@/lib/platform';
import { chainRows, computePortfolio } from '@/lib/portfolio';
import { fmt } from '@/lib/format';
import { BackCircle } from '@/features/wallet/BackCircle';
import { ChevronRightIcon, SentIcon } from '@/ui/Icons';
import '@/styles/features/wallet/earn.css';

/* ------------------------------- EARN -------------------------------- */
export function Earn({ store }: { store: WalletStore }) {
  const t = store.t;
  const { total } = computePortfolio(store.account, store.prices, store.network.id, chainRows(store.chainHoldings, store.chainNet, store.prices));
  const protocols = [
    {
      name: 'DeFindex',
      mark: 'D',
      kind: t('earn.defindexKind'),
      description: t('earn.defindexDesc'),
      action: () => store.go('defindex'),
      tone: 'defindex',
    },
    {
      name: 'Blend Protocol',
      mark: 'B',
      kind: t('earn.blendKind'),
      description: t('earn.blendDesc'),
      action: () => void import('@/lib/openExternal').then(({ openExternal }) => openExternal('https://mainnet.blend.capital/')),
      tone: 'blend',
    },
    {
      name: 'Etherfuse',
      mark: 'E',
      kind: t('earn.etherfuseKind'),
      description: t('earn.etherfuseDesc'),
      action: () => void import('@/lib/openExternal').then(({ openExternal }) => openExternal('https://app.etherfuse.com/')),
      tone: 'etherfuse',
    },
  ] as const;
  return (
    <div className="scr screen pb-110">
      <header className="earn-head">
        <h1 className="earn-title">{t('earn.title')}</h1>
        {buildKind() === 'ext' && (
          <div className="row g10">
            <BackCircle store={store} />
            <NavMenu store={store} />
          </div>
        )}
      </header>
      <section className="earn-card" aria-label={t('earn.totalAssets')}>
        <p className="earn-label">{t('earn.totalAssets')}</p>
        <p className="earn-total">${fmt(total, 2)}</p>
        <p className="earn-net-label">
          {t('earn.network')}: <span className="earn-net-value">{store.network.label}</span>
        </p>
      </section>

      <h2 className="earn-generate">{t('earn.generate')}</h2>
      <button type="button" className="glass card earn-option earn-lp tap" onClick={() => store.go('liquidity')}>
        <div className="row g12 earn-lp-head">
          <TokenAvatar glyph="◇" tone="pool" size={36} />
          <div className="earn-option-copy">
            <div className="earn-lp-title">Liquidity Pools (AMM)</div>
            <div className="t-dim-12">{t('earn.lpSub')}</div>
          </div>
          <ChevronRightIcon className="earn-option-arrow" />
        </div>
        <div className="earn-lp-desc">
          {t('earn.lpDesc')}
        </div>
        <div className="earn-lp-cta">{t('lp.open')}</div>
      </button>

      <div className="earn-protocols" aria-label={t('earn.protocols')}>
        {protocols.map((protocol) => (
          <button
            type="button"
            className={`glass card earn-option earn-protocol tap earn-protocol-${protocol.tone}`}
            onClick={protocol.action}
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
              <SentIcon className="earn-option-arrow earn-option-arrow-external" />
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
