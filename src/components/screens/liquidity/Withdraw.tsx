import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { AssetLogo, BackBar, PrimaryButton, Spinner, TokenAvatar } from '@/components/parts';
import { trim } from '@/lib/format';
import '@/styles/screens/money/swap.css';
import '@/styles/screens/money/liquidity.css';

/* -------------------------- LP WITHDRAW -------------------------- */
/**
 * Burn pool shares to redeem the proportional amounts of both reserves. The
 * redeemable preview scales with the share fraction; the on-chain minimums are
 * slippage-protected server-side. Built server-side, signed locally, then relayed.
 */
const label = (r: { asset: string }) => (r.asset === 'native' ? 'XLM' : r.asset);

export function Withdraw({ store }: { store: WalletStore }) {
  const t = store.t;
  const target = store.lpTarget?.mode === 'withdraw' ? store.lpTarget : null;
  const position = target?.position ?? null;

  const held = position ? parseFloat(position.shares) || 0 : 0;
  const [shares, setShares] = useState(position ? position.shares : '');

  // No position in context (e.g. reloaded straight onto this screen) — bail home.
  if (!position) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={t('lp.withdrawTitle')} onBack={() => store.go('liquidity')} />
        <div className="glass swap-note lp-empty">{t('lp.noPositionSelected')}</div>
      </div>
    );
  }

  const amt = parseFloat(shares) || 0;
  const fraction = held > 0 ? Math.min(1, amt / held) : 0;
  const over = amt > held;
  const canWithdraw = amt > 0 && !over;

  const setPct = (pct: number) => setShares(trim((held * pct) / 100, 7));

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('lp.withdrawTitle')} onBack={() => store.go('liquidity')} />

      <div className="glass card lp-item">
        <div className="row g10 lp-item-head">
          <TokenAvatar glyph="◇" color="rgba(255,255,255,.10)" size={34} />
          <div>
            <div className="lp-item-title">{position.reserves.map(label).join(' / ')}</div>
            <div className="t-dim-12">
              {t('lp.poolShare')}: {trim(position.shareOfPoolBps / 100, 2)}%
            </div>
          </div>
        </div>
      </div>

      <div className="glass swap-card lp-withdraw-card">
        <div className="swap-label">{t('lp.sharesToBurn')}</div>
        <div className="row between g10">
          <span className="lp-shares-glyph">◇</span>
          <input value={shares} onChange={(e) => setShares((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" className="swap-input" />
        </div>
        <div className="swap-balance">
          {t('lp.sharesHeld')}: {trim(held, 4)}
        </div>
        <div className="lp-pct-row">
          {[25, 50, 100].map((p) => (
            <button key={p} className="lp-pct" onClick={() => setPct(p)}>
              {p === 100 ? t('lp.max') : `${p}%`}
            </button>
          ))}
        </div>
      </div>

      {over && <div className="swap-guard swap-guard--danger">{t('lp.overShares', { held: trim(held, 4) })}</div>}

      <div className="glass swap-quote">
        <div className="lp-redeem-label">{t('lp.youReceiveApprox')}</div>
        {position.redeemable.map((r) => (
          <div key={label(r)} className="swap-quote-row">
            <span className="swap-quote-label row g8">
              <AssetLogo code={label(r)} size={20} /> {label(r)}
            </span>
            <span className="swap-quote-val">≈ {trim((parseFloat(r.amount) || 0) * fraction, 4)}</span>
          </div>
        ))}
      </div>

      <div className="glass swap-note">{t('lp.withdrawNote')}</div>

      <div className="swap-spacer" />
      <PrimaryButton disabled={store.busy || !canWithdraw} onClick={() => store.submitWithdraw({ poolId: position.poolId, shares })}>
        {store.busy ? <Spinner /> : t('lp.withdraw')}
      </PrimaryButton>
    </div>
  );
}
