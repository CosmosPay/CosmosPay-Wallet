import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SwapAsset, WalletStore } from '@/components/store';
import type { LiquidityPool, LiquidityPosition } from '@/lib/cosmospay';
import { AssetLogo, BackBar, PrimaryButton, Spinner, TokenAvatar, EnableReceivingCard } from '@/components/parts';
import { trim } from '@/lib/format';
import { networkEnv } from '@/lib/stellar';
import { cx } from '@/lib/cx';
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
/** Reserve/redeemable amounts as the card's asset rows want them. */
const amountRows = (rs: { asset: string; amount: string }[], decimals: number) =>
  rs.map((r) => ({ code: label(r), amount: trim(parseFloat(r.amount) || 0, decimals) }));

/** Loading / empty / list frame — both tabs load asynchronously and start at null. */
function LpSection<T>({
  store,
  items,
  emptyKey,
  children,
}: {
  store: WalletStore;
  items: T[] | null;
  emptyKey: string;
  children: (item: T) => ReactNode;
}) {
  if (items === null) {
    return (
      <div className="center g8 lp-loading">
        <Spinner tone="dim" /> {store.t('lp.loading')}
      </div>
    );
  }
  if (items.length === 0) return <div className="glass swap-note lp-empty">{store.t(emptyKey)}</div>;
  return <div className="col g10">{items.map(children)}</div>;
}

/** One pool card: pair header (+ optional trailing column), the asset amounts and
 *  the single action the card offers. Shared by both tabs. */
function LpCard({
  title,
  sub,
  right,
  rowsLabel,
  rows,
  action,
  onAction,
}: {
  title: string;
  sub: ReactNode;
  right?: ReactNode;
  rowsLabel?: string;
  rows: { code: string; amount: string }[];
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="glass card lp-item">
      <div className="row between g10 lp-item-head">
        <div className="row g10">
          <TokenAvatar glyph="◇" tone="pool" size={34} />
          <div>
            <div className="lp-item-title">{title}</div>
            <div className="t-dim-12">{sub}</div>
          </div>
        </div>
        {right}
      </div>
      <div className="lp-redeem">
        {rowsLabel && <div className="lp-redeem-label">{rowsLabel}</div>}
        {rows.map((r) => (
          <div key={r.code} className="lp-redeem-row">
            <span className="row g8">
              <AssetLogo code={r.code} size={20} /> {r.code}
            </span>
            <span className="lp-redeem-amt">{r.amount}</span>
          </div>
        ))}
      </div>
      <button className="lp-action-btn" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

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

  if (!enabled) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={t('lp.title')} onBack={() => store.go('earn', 'earn')} />
        <div className="lp-enable">
          <div className="glass swap-note">{t('lp.enableFirst')}</div>
          <EnableReceivingCard store={store} />
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('lp.title')} onBack={() => store.go('earn', 'earn')} />

      <div className="lp-tabs">
        {([['positions', t('lp.myPositions')], ['pools', t('lp.explore')]] as const).map(([key, text]) => (
          <button key={key} className={cx('lp-tab', tab === key && 'is-on')} onClick={() => setTab(key)}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'positions' ? (
        <LpSection store={store} items={positions} emptyKey="lp.noPositions">
          {(p) => (
            <LpCard
              key={p.poolId}
              title={pairLabel(p.reserves)}
              sub={`${t('lp.poolShare')}: ${trim(p.shareOfPoolBps / 100, 2)}%`}
              right={
                <div className="lp-item-shares">
                  <div className="lp-item-shares-val">{trim(parseFloat(p.shares) || 0, 4)}</div>
                  <div className="t-dim-12">{t('lp.shares')}</div>
                </div>
              }
              rowsLabel={t('lp.redeemable')}
              rows={amountRows(p.redeemable, 4)}
              action={t('lp.withdraw')}
              onAction={() => store.openWithdraw(p)}
            />
          )}
        </LpSection>
      ) : (
        <LpSection store={store} items={pools} emptyKey="lp.noPools">
          {(pool) => (
            <LpCard
              key={pool.id}
              title={pairLabel(pool.reserves)}
              sub={`${t('lp.fee')}: ${trim(pool.feeBp / 100, 2)}% · ${t('lp.tvl')} ${trim(parseFloat(pool.totalShares) || 0, 2)}`}
              rows={amountRows(pool.reserves, 2)}
              action={t('lp.deposit')}
              onAction={() => store.openDeposit(toAsset(pool.reserves[0]), toAsset(pool.reserves[1]))}
            />
          )}
        </LpSection>
      )}

      <div className="lp-spacer" />
      <PrimaryButton onClick={() => store.openDeposit()}>{t('lp.newDeposit')}</PrimaryButton>
    </div>
  );
}
