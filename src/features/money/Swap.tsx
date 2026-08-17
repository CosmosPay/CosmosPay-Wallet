import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { trim } from '@/lib/format';
import { networkEnv } from '@/lib/stellar';
import { cx } from '@/lib/cx';
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import type { SwapQuote } from '@/lib/cosmospay';
import { AssetSelect } from '@/features/money/AssetSelect';
import { assetKey, findAsset, isSameAsset, XLM, type AssetRef } from '@/lib/asset';
import { parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import '@/styles/ui/exchange-card.css';
import '@/styles/features/money/swap.css';

/* ------------------------------- SWAP ------------------------------- */
// Auto-quote cadence: re-price this long after the last input change (debounce),
// and refresh on this interval so a sitting quote stays fresh. Each quote is a real
// Horizon path search, so we don't poll every second — drop QUOTE_REFRESH_MS to 1000
// if you want literal 1s refresh. The executed swap re-prices server-side regardless.

/**
 * Swap any trustlined asset for another via CosmosPay (preferential rate per the
 * org plan). The gateway builds the transaction (XDR), we sign it locally with the
 * wallet secret, and the gateway submits it — the wallet stays non-custodial.
 * Requires a provisioned/linked CosmosPay account.
 */
export function Swap({ store }: { store: WalletStore }) {
  const t = store.t;
  // Both sides can be any trustlined asset (XLM always present).
  const assets = sendableAssets(store.account);
  const firstDest = assets.find((a) => !a.isNative && a.code !== 'XLM');

  // Both sides are held as full (code, issuer) refs. Keeping only the code meant
  // `assets.find(a => a.code === …)` picked whichever look-alike Horizon listed first.
  const [fromRef, setFromRef] = useState<AssetRef>(XLM);
  const [toRef, setToRef] = useState<AssetRef>(
    firstDest ? { code: firstDest.code, issuer: firstDest.issuer } : { code: 'USDC', issuer: null },
  );
  const [pay, setPay] = useState('1');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // Which token dropdown is open. The glass cards each create a backdrop-filter stacking
  // context, so an open menu would be painted under the sibling card / quote below it.
  // We lift the active card (and the whole stack) above the rest while a menu is open.
  const [openSel, setOpenSel] = useState<null | 'from' | 'to'>(null);

  const from = findAsset(assets, fromRef);
  const to = findAsset(assets, toRef);
  const fromBal = parseDecimalOr0(from?.balance);
  const payNum = parseDecimalOr0(pay);
  // "Enabled" for swapping means we have a CosmosPay key for the wallet's CURRENT network
  // (testnet -> dev, mainnet -> prod). If the account exists but lacks this network's key
  // (e.g. an older single-key account), the link card shows so the user can mint both.
  const enabled = !!store.cosmosPay?.keys[networkEnv(store.network)];
  const sameAsset = isSameAsset(fromRef, toRef);
  // Spendable amount of the source asset — XLM keeps the account's minimum reserve free,
  // so the swap (which sends the gross amount) can't exceed it. Prevents op_underfunded.
  const availFrom = from ? (from.isNative ? spendableXlm(store.account) : parseFloat(from.balance) || 0) : 0;
  const insufficient = payNum > 0 && payNum > availFrom;
  // `!!quote` is a requirement, not a nicety: the guard bounds the signature by the
  // quote's "minimum received", so swapping without one would have nothing to bound.
  const canSwap = enabled && payNum > 0 && !sameAsset && !!from && !!to && !insufficient && !!quote;

  // The receive amount comes straight from the gateway quote — no CoinGecko/market
  // approximation here, so what's shown is exactly what the swap routes.
  const receive = quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  // Commission rate the user is actually charged (bps -> %), shown for transparency.
  const feePct = quote ? quote.fee.bps / 100 : null;
  // Effective rate the user actually gets (fee included): dest estimated per 1 unit paid.
  const rate = quote && payNum > 0 ? (parseFloat(quote.destination.estimated) || 0) / payNum : null;

  // Clear a stale quote the instant the amount or either asset changes.
  useEffect(() => {
    setQuote(null);
  }, [pay, assetKey(fromRef), assetKey(toRef)]);

  // Auto-quote: re-price shortly after any change (debounced) and refresh on an
  // interval, so the shown cost stays coherent — no manual "get quote" step. The
  // executed swap re-prices server-side on submit and enforces destMin, so the user
  // is protected even if the displayed quote is a few seconds old.
  useEffect(() => {
    if (!enabled || payNum <= 0 || !from || !to || sameAsset) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      const q = await store.quoteSwap(pay, from, to);
      if (cancelled) return;
      setQuoting(false);
      if (q) setQuote(q);
    };
    const debounce = setTimeout(run, QUOTE_DEBOUNCE_MS);
    const refresh = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, assetKey(fromRef), assetKey(toRef), enabled, store.account]);

  // Swap the two sides (and any quote, which no longer applies).
  const invert = () => {
    setFromRef(toRef);
    setToRef(fromRef);
    setQuote(null);
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('swap.title')} onBack={store.goBack} />

      <div className={cx('exchange-stack', openSel && 'is-open')}>
        <div className={cx('glass exchange-card', openSel === 'from' && 'is-active')}>
          <div className="exchange-label">{t('swap.pay')}</div>
          <div className="row between g10">
            <AssetSelect assets={assets} value={fromRef} onPick={(a) => setFromRef({ code: a.code, issuer: a.issuer })} open={openSel === 'from'} onToggle={(n) => setOpenSel(n ? 'from' : null)} />
            <input value={pay} onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setPay(v); }} inputMode="decimal" className="exchange-input" />
          </div>
          <div className="exchange-balance">
            {t('swap.balance')}: {trim(fromBal, 4)} {fromRef.code}
          </div>
        </div>
        {/* Zero-height anchor BETWEEN the cards: the button centres on the exact seam
            (from-card bottom + half the 10px gap) no matter how tall each card is —
            top:50% of the whole wrapper sat visibly too high. */}
        <div className="swap-seam">
          <button onClick={invert} aria-label="invert" className="swap-invert">⇅</button>
        </div>
        <div className={cx('glass exchange-card exchange-card--to', openSel === 'to' && 'is-active')}>
          <div className="exchange-label">{t('swap.receiveEst')}</div>
          <div className="row between g10">
            <AssetSelect assets={assets} value={toRef} onPick={(a) => setToRef({ code: a.code, issuer: a.issuer })} open={openSel === 'to'} onToggle={(n) => setOpenSel(n ? 'to' : null)} />
            <div className={cx('swap-receive', !quote && 'is-empty')}>{quote ? trim(receive, 4) : '—'}</div>
          </div>
          {rate !== null && (
            <div className="swap-rate">
              1 {fromRef.code} ≈ {trim(rate, rate < 1 ? 6 : 4)} {toRef.code}
            </div>
          )}
        </div>
      </div>

      {/* Same-asset guard. */}
      {enabled && sameAsset && (
        <div className="exchange-guard">{t('swap.sameAsset')}</div>
      )}

      {/* Insufficient-balance guard (reserve-aware for XLM). */}
      {enabled && !sameAsset && insufficient && (
        <div className="exchange-guard exchange-guard--danger">
          {t('swap.insufficient', { avail: trim(availFrom, 4), code: fromRef.code })}
        </div>
      )}

      {/* Quotes refresh automatically — show a subtle indicator while re-pricing. */}
      {enabled && quoting && (
        <div className="center g8 swap-quoting">
          <Spinner tone="dim" /> {t('swap.quoting')}
        </div>
      )}

      {/* Quote breakdown: commission RATE + amount + min, so the cost is transparent. */}
      {quote && (
        <div className="glass exchange-quote">
          {[
            [t('swap.feeRate'), feePct !== null ? `${trim(feePct, 2)}%` : '—'],
            [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 4)} ${quote.fee.asset}`],
            [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 4)} ${quote.destination.asset}`],
            [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 4)} ${quote.destination.asset}`],
          ].map(([label, val]) => (
            <div key={label} className="exchange-quote-row">
              <span className="exchange-quote-label">{label}</span>
              <span className="exchange-quote-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* When enabled, a short note; otherwise the CosmosPay card below explains the step. */}
      {enabled && (
        <div className="glass exchange-note">
          {t('swap.note2')}
        </div>
      )}

      <div className="spacer" />
      {enabled ? (
        // The quote travels with the submit: the guard bounds the envelope by what THIS
        // card showed (pay, and the "minimum received" row), never by the create
        // response that carries the XDR.
        <PrimaryButton disabled={store.busy || !canSwap} onClick={() => from && to && quote && store.submitSwap(pay, from, to, quote)}>
          {store.busy ? <Spinner /> : t('swap.cta')}
        </PrimaryButton>
      ) : (
        // Not provisioned/linked yet — route through the same Cosmos account flow as Home
        // (enable → confirm email, or link an existing account via a one-time access code).
        <EnableReceivingCard store={store} />
      )}
    </div>
  );
}
