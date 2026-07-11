import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner, EnableReceivingCard } from '@/components/parts';
import { trim } from '@/lib/format';
import { networkEnv } from '@/lib/stellar';
import { QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import type { SwapQuote } from '@/lib/cosmospay';
import { spendableXlm, sendableAssets, SwapTokenSelect } from './shared';
import '@/styles/screens/money/swap.css';

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
  const assets = sendableAssets(store);
  const firstDest = assets.find((a) => !a.isNative && a.code !== 'XLM');

  const [fromCode, setFromCode] = useState('XLM');
  const [toCode, setToCode] = useState(firstDest?.code ?? 'USDC');
  const [pay, setPay] = useState('1');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // Which token dropdown is open. The glass cards each create a backdrop-filter stacking
  // context, so an open menu would be painted under the sibling card / quote below it.
  // We lift the active card (and the whole stack) above the rest while a menu is open.
  const [openSel, setOpenSel] = useState<null | 'from' | 'to'>(null);

  const from = assets.find((a) => a.code === fromCode);
  const to = assets.find((a) => a.code === toCode);
  const fromBal = parseFloat(from?.balance ?? '0') || 0;
  const payNum = parseFloat(pay) || 0;
  // "Enabled" for swapping means we have a CosmosPay key for the wallet's CURRENT network
  // (testnet -> dev, mainnet -> prod). If the account exists but lacks this network's key
  // (e.g. an older single-key account), the link card shows so the user can mint both.
  const enabled = !!store.cosmosPay?.keys[networkEnv(store.network)];
  const sameAsset = fromCode === toCode;
  // Spendable amount of the source asset — XLM keeps the account's minimum reserve free,
  // so the swap (which sends the gross amount) can't exceed it. Prevents op_underfunded.
  const availFrom = from ? (from.isNative ? spendableXlm(store) : parseFloat(from.balance) || 0) : 0;
  const insufficient = payNum > 0 && payNum > availFrom;
  const canSwap = enabled && payNum > 0 && !sameAsset && !!from && !!to && !insufficient;

  // The receive amount comes straight from the gateway quote — no CoinGecko/market
  // approximation here, so what's shown is exactly what the swap routes.
  const receive = quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  // Commission rate the user is actually charged (bps -> %), shown for transparency.
  const feePct = quote ? quote.fee.bps / 100 : null;
  // Effective rate the user actually gets (fee included): dest estimated per 1 unit paid.
  const rate = quote && payNum > 0 ? (parseFloat(quote.destination.estimated) || 0) / payNum : null;

  const asSwapAsset = (b: { code: string; issuer: string | null }) => ({ code: b.code, issuer: b.issuer });

  // Clear a stale quote the instant the amount or either asset changes.
  useEffect(() => {
    setQuote(null);
  }, [pay, fromCode, toCode]);

  // Auto-quote: re-price shortly after any change (debounced) and refresh on an
  // interval, so the shown cost stays coherent — no manual "get quote" step. The
  // executed swap re-prices server-side on submit and enforces destMin, so the user
  // is protected even if the displayed quote is a few seconds old.
  useEffect(() => {
    const amt = parseFloat(pay) || 0;
    const f = assets.find((a) => a.code === fromCode);
    const tt = assets.find((a) => a.code === toCode);
    if (!enabled || amt <= 0 || !f || !tt || f.code === tt.code) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      const q = await store.quoteSwap(pay, { code: f.code, issuer: f.issuer }, { code: tt.code, issuer: tt.issuer });
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
  }, [pay, fromCode, toCode, enabled, store.account]);

  // Swap the two sides (and any quote, which no longer applies).
  const invert = () => {
    setFromCode(toCode);
    setToCode(fromCode);
    setQuote(null);
  };

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('swap.title')} onBack={() => store.go('home', 'home')} />

      <div className={openSel ? 'swap-stack is-open' : 'swap-stack'}>
        <div className={openSel === 'from' ? 'glass swap-card is-active' : 'glass swap-card'}>
          <div className="swap-label">{t('swap.pay')}</div>
          <div className="row between g10">
            <SwapTokenSelect assets={assets} code={fromCode} onPick={setFromCode} open={openSel === 'from'} onToggle={(n) => setOpenSel(n ? 'from' : null)} />
            <input value={pay} onChange={(e) => setPay((e.target as HTMLInputElement).value)} inputMode="decimal" className="swap-input" />
          </div>
          <div className="swap-balance">
            {t('swap.balance')}: {trim(fromBal, 4)} {fromCode}
          </div>
        </div>
        {/* Zero-height anchor BETWEEN the cards: the button centres on the exact seam
            (from-card bottom + half the 10px gap) no matter how tall each card is —
            top:50% of the whole wrapper sat visibly too high. */}
        <div className="swap-seam">
          <button onClick={invert} aria-label="invert" className="swap-invert">⇅</button>
        </div>
        <div className={openSel === 'to' ? 'glass swap-card swap-card--to is-active' : 'glass swap-card swap-card--to'}>
          <div className="swap-label">{t('swap.receiveEst')}</div>
          <div className="row between g10">
            <SwapTokenSelect assets={assets} code={toCode} onPick={setToCode} open={openSel === 'to'} onToggle={(n) => setOpenSel(n ? 'to' : null)} />
            <div className={quote ? 'swap-receive' : 'swap-receive is-empty'}>{quote ? trim(receive, 4) : '—'}</div>
          </div>
          {rate !== null && (
            <div className="swap-rate">
              1 {fromCode} ≈ {trim(rate, rate < 1 ? 6 : 4)} {toCode}
            </div>
          )}
        </div>
      </div>

      {/* Same-asset guard. */}
      {enabled && sameAsset && (
        <div className="swap-guard">{t('swap.sameAsset')}</div>
      )}

      {/* Insufficient-balance guard (reserve-aware for XLM). */}
      {enabled && !sameAsset && insufficient && (
        <div className="swap-guard swap-guard--danger">
          {t('swap.insufficient', { avail: trim(availFrom, 4), code: fromCode })}
        </div>
      )}

      {/* Quotes refresh automatically — show a subtle indicator while re-pricing. */}
      {enabled && quoting && (
        <div className="center g8 swap-quoting">
          <Spinner color="var(--dim)" /> {t('swap.quoting')}
        </div>
      )}

      {/* Quote breakdown: commission RATE + amount + min, so the cost is transparent. */}
      {quote && (
        <div className="glass swap-quote">
          {[
            [t('swap.feeRate'), feePct !== null ? `${trim(feePct, 2)}%` : '—'],
            [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 4)} ${quote.fee.asset}`],
            [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 4)} ${quote.destination.asset}`],
            [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 4)} ${quote.destination.asset}`],
          ].map(([label, val]) => (
            <div key={label} className="swap-quote-row">
              <span className="swap-quote-label">{label}</span>
              <span className="swap-quote-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* When enabled, a short note; otherwise the CosmosPay card below explains the step. */}
      {enabled && (
        <div className="glass swap-note">
          {t('swap.note2')}
        </div>
      )}

      <div className="swap-spacer" />
      {enabled ? (
        <PrimaryButton disabled={store.busy || !canSwap} onClick={() => from && to && store.submitSwap(pay, asSwapAsset(from), asSwapAsset(to))}>
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
