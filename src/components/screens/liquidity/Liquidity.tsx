import { useEffect, useState } from 'react';
import type { SwapAsset, WalletStore } from '@/components/store';
import type { LiquidityPool, LiquidityPosition } from '@/lib/cosmospay';
import { AssetLogo, BackBar, PrimaryButton, Spinner, TokenAvatar, EnableReceivingCard } from '@/components/parts';
import { trim } from '@/lib/format';
import { networkEnv } from '@/lib/stellar';
import '@/styles/screens/money/liquidity.css';

/* ----------------------------- LIQUIDITY ----------------------------- */
/**
 * Liquidity pools hub (AMM). Two tabs: explore on-chain pools and view this
 * wallet's positions. Deposits/withdrawals go through the non-custodial CosmosPay
 * flow (server builds the XDR, the wallet signs it locally). Requires a CosmosPay
 * account for the current network — otherwise the enable card is shown.
 */

const label = (r: { asset: string }) => (r.asset === 'native' ? 'XLM' : r.asset);
const toAsset = (r: { asset: string; issuer: string | null }): SwapAsset => ({
  code: r.asset === 'native' ? 'XLM' : r.asset,
  issuer: r.issuer,
});
const pairLabel = (rs: { asset: string }[]) => rs.map(label).join(' / ');

export function Liquidity({ store }: { store: WalletStore }) {
  const t = store.t;
  const enabled = !!store.cosmosPay?.keys[networkEnv(store.network)];
  const [tab, setTab] = useState<'pools' | 'positions'>('positions');

  const [pools, setPools] = useState<LiquidityPool[] | null>(null);
  const [positions, setPositions] = useState<LiquidityPosition[] | null>(null);

  // Load the wallet's positions once on mount (cheap: one account call).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    store.liquidityPositions().then((p) => {
      if (!cancelled) setPositions(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, store.account]);

  // Lazy-load the pool explorer the first time that tab is opened.
  useEffect(() => {
    if (!enabled || tab !== 'pools' || pools !== null) return;
    let cancelled = false;
    store.listPools({ limit: 12 }).then((p) => {
      if (!cancelled) setPools(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tab]);

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('lp.title')} onBack={() => store.go('earn', 'earn')} />

      {!enabled ? (
        <div className="lp-enable">
          <div className="glass swap-note">{t('lp.enableFirst')}</div>
          <EnableReceivingCard store={store} />
        </div>
      ) : (
        <>
          <div className="lp-tabs">
            <button className={tab === 'positions' ? 'lp-tab is-on' : 'lp-tab'} onClick={() => setTab('positions')}>
              {t('lp.myPositions')}
            </button>
            <button className={tab === 'pools' ? 'lp-tab is-on' : 'lp-tab'} onClick={() => setTab('pools')}>
              {t('lp.explore')}
            </button>
          </div>

          {tab === 'positions' && <Positions store={store} positions={positions} />}
          {tab === 'pools' && <Pools store={store} pools={pools} />}

          <div className="lp-spacer" />
          <PrimaryButton onClick={() => store.openDeposit()}>{t('lp.newDeposit')}</PrimaryButton>
        </>
      )}
    </div>
  );
}

/* --------------------------- positions tab --------------------------- */
function Positions({ store, positions }: { store: WalletStore; positions: LiquidityPosition[] | null }) {
  const t = store.t;
  if (positions === null) {
    return (
      <div className="center g8 lp-loading">
        <Spinner color="var(--dim)" /> {t('lp.loading')}
      </div>
    );
  }
  if (positions.length === 0) {
    return <div className="glass swap-note lp-empty">{t('lp.noPositions')}</div>;
  }
  return (
    <div className="col g10">
      {positions.map((p) => (
        <div key={p.poolId} className="glass card lp-item">
          <div className="row between g10 lp-item-head">
            <div className="row g10">
              <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={34} />
              <div>
                <div className="lp-item-title">{pairLabel(p.reserves)}</div>
                <div className="t-dim-12">
                  {t('lp.poolShare')}: {trim(p.shareOfPoolBps / 100, 2)}%
                </div>
              </div>
            </div>
            <div className="lp-item-shares">
              <div className="lp-item-shares-val">{trim(parseFloat(p.shares) || 0, 4)}</div>
              <div className="t-dim-12">{t('lp.shares')}</div>
            </div>
          </div>
          <div className="lp-redeem">
            <div className="lp-redeem-label">{t('lp.redeemable')}</div>
            {p.redeemable.map((r) => (
              <div key={label(r)} className="lp-redeem-row">
                <span className="row g8">
                  <AssetLogo code={label(r)} size={20} /> {label(r)}
                </span>
                <span className="lp-redeem-amt">{trim(parseFloat(r.amount) || 0, 4)}</span>
              </div>
            ))}
          </div>
          <button className="lp-action-btn" onClick={() => store.openWithdraw(p)}>
            {t('lp.withdraw')}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- pools tab ----------------------------- */
function Pools({ store, pools }: { store: WalletStore; pools: LiquidityPool[] | null }) {
  const t = store.t;
  if (pools === null) {
    return (
      <div className="center g8 lp-loading">
        <Spinner color="var(--dim)" /> {t('lp.loading')}
      </div>
    );
  }
  if (pools.length === 0) {
    return <div className="glass swap-note lp-empty">{t('lp.noPools')}</div>;
  }
  return (
    <div className="col g10">
      {pools.map((pool) => (
        <div key={pool.id} className="glass card lp-item">
          <div className="row between g10 lp-item-head">
            <div className="row g10">
              <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={34} />
              <div>
                <div className="lp-item-title">{pairLabel(pool.reserves)}</div>
                <div className="t-dim-12">
                  {t('lp.fee')}: {trim(pool.feeBp / 100, 2)}% · {t('lp.tvl')} {trim(parseFloat(pool.totalShares) || 0, 2)}
                </div>
              </div>
            </div>
          </div>
          <div className="lp-redeem">
            {pool.reserves.map((r) => (
              <div key={label(r)} className="lp-redeem-row">
                <span className="row g8">
                  <AssetLogo code={label(r)} size={20} /> {label(r)}
                </span>
                <span className="lp-redeem-amt">{trim(parseFloat(r.amount) || 0, 2)}</span>
              </div>
            ))}
          </div>
          <button
            className="lp-action-btn"
            onClick={() => store.openDeposit(toAsset(pool.reserves[0]), toAsset(pool.reserves[1]))}
          >
            {t('lp.deposit')}
          </button>
        </div>
      ))}
    </div>
  );
}
