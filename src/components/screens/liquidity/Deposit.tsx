import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar, PrimaryButton, Spinner } from '@/components/parts';
import { trim } from '@/lib/format';
import { spendableXlm, sendableAssets, SwapTokenSelect } from '@/components/screens/money/shared';
import '@/styles/screens/money/swap.css';
import '@/styles/screens/money/liquidity.css';

/* -------------------------- LP DEPOSIT -------------------------- */
/**
 * Deposit a pair into a Stellar AMM pool. Both sides are free trustlined assets
 * (XLM always present). The gateway prices the deposit against the pool's current
 * reserves — for a funded pool the second amount can be left blank and is derived
 * from the pool ratio. The tx is built server-side, signed locally, then relayed.
 */
export function Deposit({ store }: { store: WalletStore }) {
  const t = store.t;
  const assets = sendableAssets(store);
  const preset = store.lpTarget?.mode === 'deposit' ? store.lpTarget : null;
  const firstB = assets.find((a) => !a.isNative && a.code !== 'XLM');

  const [aCode, setACode] = useState(preset?.presetA?.code ?? 'XLM');
  const [bCode, setBCode] = useState(preset?.presetB?.code ?? firstB?.code ?? 'USDC');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [openSel, setOpenSel] = useState<null | 'a' | 'b'>(null);

  const a = assets.find((x) => x.code === aCode);
  const b = assets.find((x) => x.code === bCode);
  const amtA = parseFloat(amountA) || 0;
  const amtB = parseFloat(amountB) || 0;

  const availA = a ? (a.isNative ? spendableXlm(store) : parseFloat(a.balance) || 0) : 0;
  const availB = b ? (b.isNative ? spendableXlm(store) : parseFloat(b.balance) || 0) : 0;
  const sameAsset = aCode === bCode;
  const overA = amtA > availA;
  const overB = amtB > availB; // amountB is optional; only guards when the user typed one
  const canDeposit = amtA > 0 && !sameAsset && !!a && !!b && !overA && !overB;

  const asAsset = (x: { code: string; issuer: string | null }) => ({ code: x.code, issuer: x.issuer });

  const submit = () => {
    if (!a || !b) return;
    store.submitDeposit({
      assetA: asAsset(a),
      assetB: asAsset(b),
      maxAmountA: amountA,
      maxAmountB: amountB.trim() ? amountB : undefined,
    });
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('lp.depositTitle')} onBack={() => store.go('liquidity')} />

      <div className={openSel ? 'swap-stack is-open' : 'swap-stack'}>
        <div className={openSel === 'a' ? 'glass swap-card is-active' : 'glass swap-card'}>
          <div className="swap-label">{t('lp.assetA')}</div>
          <div className="row between g10">
            <SwapTokenSelect assets={assets} code={aCode} onPick={setACode} open={openSel === 'a'} onToggle={(n) => setOpenSel(n ? 'a' : null)} />
            <input value={amountA} onChange={(e) => setAmountA((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" className="swap-input" />
          </div>
          <div className="swap-balance">
            {t('swap.balance')}: {trim(availA, 4)} {aCode}
          </div>
        </div>

        <div className="lp-plus-seam">
          <span className="lp-plus">+</span>
        </div>

        <div className={openSel === 'b' ? 'glass swap-card swap-card--to is-active' : 'glass swap-card swap-card--to'}>
          <div className="swap-label">{t('lp.assetB')}</div>
          <div className="row between g10">
            <SwapTokenSelect assets={assets} code={bCode} onPick={setBCode} open={openSel === 'b'} onToggle={(n) => setOpenSel(n ? 'b' : null)} />
            <input value={amountB} onChange={(e) => setAmountB((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder={t('lp.autoAmount')} className="swap-input" />
          </div>
          <div className="swap-balance">
            {t('swap.balance')}: {trim(availB, 4)} {bCode}
          </div>
        </div>
      </div>

      {sameAsset && <div className="swap-guard">{t('lp.sameAsset')}</div>}
      {!sameAsset && overA && (
        <div className="swap-guard swap-guard--danger">{t('swap.insufficient', { avail: trim(availA, 4), code: aCode })}</div>
      )}
      {!sameAsset && !overA && overB && (
        <div className="swap-guard swap-guard--danger">{t('swap.insufficient', { avail: trim(availB, 4), code: bCode })}</div>
      )}

      <div className="glass swap-note">{t('lp.depositNote')}</div>

      <div className="swap-spacer" />
      <PrimaryButton disabled={store.busy || !canDeposit} onClick={submit}>
        {store.busy ? <Spinner /> : t('lp.deposit')}
      </PrimaryButton>
    </div>
  );
}
