import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { AssetSelect } from '@/features/money/AssetSelect';
import { findAsset, isSameAsset, XLM, type AssetRef } from '@/lib/asset';
import { parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import '@/styles/ui/exchange-card.css';
import '@/styles/features/liquidity/liquidity.css';

/* -------------------------- LP DEPOSIT -------------------------- */
/**
 * Deposit a pair into a Stellar AMM pool. Both sides are free trustlined assets
 * (XLM always present). The gateway prices the deposit against the pool's current
 * reserves — for a funded pool the second amount can be left blank and is derived
 * from the pool ratio. The tx is built server-side, signed locally, then relayed.
 */
export function Deposit({ store }: { store: WalletStore }) {
  const t = store.t;
  const assets = sendableAssets(store.account);
  const preset = store.lpTarget?.mode === 'deposit' ? store.lpTarget : null;
  const firstB = assets.find((a) => !a.isNative && a.code !== 'XLM');

  // Full (code, issuer) refs — the pool a deposit lands in is defined by the issuers,
  // so resolving them by code would let a look-alike token pick the pool.
  const [aRef, setARef] = useState<AssetRef>(preset?.presetA ?? XLM);
  const [bRef, setBRef] = useState<AssetRef>(
    preset?.presetB ?? (firstB ? { code: firstB.code, issuer: firstB.issuer } : { code: 'USDC', issuer: null }),
  );
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [openSel, setOpenSel] = useState<null | 'a' | 'b'>(null);

  const a = findAsset(assets, aRef);
  const b = findAsset(assets, bRef);
  const amtA = parseDecimalOr0(amountA);
  const amtB = parseDecimalOr0(amountB);

  const availA = a ? (a.isNative ? spendableXlm(store.account) : parseFloat(a.balance) || 0) : 0;
  const availB = b ? (b.isNative ? spendableXlm(store.account) : parseFloat(b.balance) || 0) : 0;
  const sameAsset = isSameAsset(aRef, bRef);
  const overA = amtA > availA;
  const overB = amtB > availB; // amountB is optional; only guards when the user typed one
  const canDeposit = amtA > 0 && !sameAsset && !!a && !!b && !overA && !overB;

  const submit = () => {
    if (!a || !b) return;
    store.submitDeposit({
      assetA: a,
      assetB: b,
      maxAmountA: amountA,
      maxAmountB: amountB.trim() ? amountB : undefined,
    });
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('lp.depositTitle')} onBack={store.goBack} />

      <div className={cx('exchange-stack', openSel && 'is-open')}>
        <div className={cx('glass exchange-card', openSel === 'a' && 'is-active')}>
          <div className="exchange-label">{t('lp.assetA')}</div>
          <div className="row between g10">
            <AssetSelect assets={assets} value={aRef} onPick={(x) => setARef({ code: x.code, issuer: x.issuer })} open={openSel === 'a'} onToggle={(n) => setOpenSel(n ? 'a' : null)} />
            <input value={amountA} onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setAmountA(v); }} inputMode="decimal" placeholder="0" className="exchange-input" />
          </div>
          <div className="exchange-balance">
            {t('swap.balance')}: {trim(availA, 4)} {aRef.code}
          </div>
        </div>

        <div className="lp-plus-seam">
          <span className="lp-plus">+</span>
        </div>

        <div className={cx('glass exchange-card exchange-card--to', openSel === 'b' && 'is-active')}>
          <div className="exchange-label">{t('lp.assetB')}</div>
          <div className="row between g10">
            <AssetSelect assets={assets} value={bRef} onPick={(x) => setBRef({ code: x.code, issuer: x.issuer })} open={openSel === 'b'} onToggle={(n) => setOpenSel(n ? 'b' : null)} />
            <input value={amountB} onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setAmountB(v); }} inputMode="decimal" placeholder={t('lp.autoAmount')} className="exchange-input" />
          </div>
          <div className="exchange-balance">
            {t('swap.balance')}: {trim(availB, 4)} {bRef.code}
          </div>
        </div>
      </div>

      {sameAsset && <div className="exchange-guard">{t('lp.sameAsset')}</div>}
      {!sameAsset && overA && (
        <div className="exchange-guard exchange-guard--danger">{t('swap.insufficient', { avail: trim(availA, 4), code: aRef.code })}</div>
      )}
      {!sameAsset && !overA && overB && (
        <div className="exchange-guard exchange-guard--danger">{t('swap.insufficient', { avail: trim(availB, 4), code: bRef.code })}</div>
      )}

      <div className="glass exchange-note">{t('lp.depositNote')}</div>

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={store.busy || !canDeposit} onClick={submit}>
          {store.busy ? <Spinner /> : t('lp.deposit')}
        </PrimaryButton>
      </div>
    </div>
  );
}
