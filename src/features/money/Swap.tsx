import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { CROSS_CHAIN_TARGET_SYMBOLS, QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import type { CrossChainAsset, CrossChainQuote, CrossChainTarget, SwapQuote } from '@/lib/cosmospay';
import { networkEnv } from '@/lib/stellar';
import { AssetSelect } from '@/features/money/AssetSelect';
import { ChainSwap } from '@/features/money/ChainSwap';
import type { OtherChain } from '@/constants/chains';
import { assetKey, findAsset, gatewayAssetLabel, isSameAsset, XLM, type AssetRef } from '@/lib/asset';
import { parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import '@/styles/ui/exchange-card.css';
import '@/styles/features/money/swap.css';

/* ------------------------------- SWAP ------------------------------- */
// Auto-quote cadence: re-price this long after the last input change (debounce),
// and refresh on this interval so a sitting quote stays fresh. Each quote is a real
// Horizon path search, so we don't poll every second — drop QUOTE_REFRESH_MS to 1000
// if you want literal 1s refresh. The executed swap re-prices server-side regardless.

/** Where the output lands: Stellar (a path payment) or another network (NEAR Intents). */
type Target = 'stellar' | CrossChainTarget;
const TARGETS: Target[] = ['stellar', 'solana', 'monad'];
/** Where the swap pays from. Stellar is this screen; Solana / Monad are `ChainSwap`. */
type Origin = 'stellar' | OtherChain;
const ORIGINS: Origin[] = ['stellar', 'solana', 'monad'];

/**
 * Swap any trustlined asset for another via CosmosPay (preferential rate per the
 * org plan). The gateway builds the transaction (XDR), we sign it locally with the
 * wallet secret, and the gateway submits it — the wallet stays non-custodial.
 *
 * "Receive on" Solana or Monad makes it a cross-chain swap instead: the wallet pays a
 * NEAR Intents deposit address from its Stellar account (a payment it builds and signs
 * itself), and the output lands on its own Solana / Monad address — the one the same
 * recovery phrase derives. Mainnet only.
 *
 * "Pay from" Solana or Monad hands the screen to `ChainSwap`: a Jupiter / Kuru Flow swap
 * on that chain, or a NEAR Intents swap from it to another (Stellar included).
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

  // Cross-chain state: the network the output lands on, what NEAR Intents lists, the
  // chosen destination asset and its quote.
  // Opens on the chain the Home card asked for, once: the next visit starts from Stellar.
  const [origin, setOrigin] = useState<Origin>(store.swapOrigin);
  const { setSwapOrigin } = store;
  useEffect(() => {
    setSwapOrigin('stellar');
  }, [setSwapOrigin]);
  const [target, setTarget] = useState<Target>('stellar');
  const [xAssets, setXAssets] = useState<CrossChainAsset[]>([]);
  const [xDestId, setXDestId] = useState<string | null>(null);
  const [xQuote, setXQuote] = useState<CrossChainQuote | null>(null);
  const crossChain = target !== 'stellar';

  const from = findAsset(assets, fromRef);
  const to = findAsset(assets, toRef);
  const fromBal = parseDecimalOr0(from?.balance);
  const payNum = parseDecimalOr0(pay);
  // "Enabled" for swapping means we have a CosmosPay key for the wallet's CURRENT network
  // (testnet -> dev, mainnet -> prod). If the account exists but lacks this network's key
  // (e.g. an older single-key account), the link card shows so the user can mint both.
  // Swapping needs a gateway credential, not an ACCOUNT. Without one of their own
  // the user swaps on the shared public key at the community rate (150 bps); with
  // one they get their plan's. Gating this on `cosmosPay` — as it did — put a
  // registration wall in front of the feature, when the account only ever changed
  // the price. `store.publicAccess` is what the rate notice below reads.
  const enabled = store.gatewayAccess;
  const sameAsset = isSameAsset(fromRef, toRef);
  // Spendable amount of the source asset — XLM keeps the account's minimum reserve free,
  // so the swap (which sends the gross amount) can't exceed it. Prevents op_underfunded.
  const availFrom = from ? (from.isNative ? spendableXlm(store.account) : parseFloat(from.balance) || 0) : 0;
  const insufficient = payNum > 0 && payNum > availFrom;
  // `!!quote` is a requirement, not a nicety: the guard bounds the signature by the
  // quote's "minimum received", so swapping without one would have nothing to bound.
  const canSwap = enabled && payNum > 0 && !sameAsset && !!from && !!to && !insufficient && !!quote;

  // --- cross-chain ---
  const mainnet = networkEnv(store.network) === 'prod';
  const recipient = crossChain ? store.meta?.chainAddresses?.[target as CrossChainTarget] ?? null : null;
  // What may leave Stellar is what NEAR Intents lists there (XLM, Circle USDC).
  const stellarListed = xAssets.filter((a) => a.chain === 'stellar');
  const fromListed = stellarListed.some(
    (a) => a.symbol === fromRef.code && (a.contract ?? null) === (fromRef.code === 'XLM' ? null : fromRef.issuer ?? null),
  );
  const destOptions = crossChain
    ? CROSS_CHAIN_TARGET_SYMBOLS[target as CrossChainTarget]
        .map((sym) => xAssets.find((a) => a.chain === target && a.symbol === sym))
        .filter((a): a is CrossChainAsset => !!a)
    : [];
  const xDest = destOptions.find((a) => a.assetId === xDestId) ?? destOptions[0] ?? null;
  const canCrossSwap =
    enabled && mainnet && !!recipient && fromListed && !!from && !!xDest && payNum > 0 && !insufficient && !!xQuote;

  // The receive amount comes straight from the gateway quote — no CoinGecko/market
  // approximation here, so what's shown is exactly what the swap routes.
  const receive = crossChain
    ? xQuote ? parseFloat(xQuote.destination.amount) || 0 : 0
    : quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  // Commission rate the user is actually charged (bps -> %), shown for transparency.
  const feePct = crossChain ? (xQuote ? xQuote.fee.bps / 100 : null) : quote ? quote.fee.bps / 100 : null;
  // Effective rate the user actually gets (fee included): dest per 1 unit paid.
  const rate = receive > 0 && payNum > 0 ? receive / payNum : null;
  const receiveCode = crossChain ? xDest?.symbol ?? '' : toRef.code;

  // Clear a stale quote the instant the amount, either asset or the network changes.
  useEffect(() => {
    setQuote(null);
    setXQuote(null);
  }, [pay, assetKey(fromRef), assetKey(toRef), target, xDest?.assetId]);

  // The cross-chain side needs NEAR Intents' list and this phrase's addresses.
  useEffect(() => {
    if (!crossChain) return;
    store.ensureChainAddresses();
    if (xAssets.length) return;
    let cancelled = false;
    store.crossChainAssets().then((list) => { if (!cancelled) setXAssets(list); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossChain]);

  // Auto-quote: re-price shortly after any change (debounced) and refresh on an
  // interval, so the shown cost stays coherent — no manual "get quote" step. The
  // executed swap re-prices server-side on submit and enforces destMin, so the user
  // is protected even if the displayed quote is a few seconds old.
  useEffect(() => {
    if (!enabled || payNum <= 0 || !from) return;
    if (crossChain ? !mainnet || !recipient || !fromListed || !xDest : !to || sameAsset) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      if (crossChain) {
        const q = await store.quoteCrossChain(pay, from, target as CrossChainTarget, xDest!);
        if (cancelled) return;
        setQuoting(false);
        if (q) setXQuote(q);
      } else {
        const q = await store.quoteSwap(pay, from, to!);
        if (cancelled) return;
        setQuoting(false);
        if (q) setQuote(q);
      }
    };
    const debounce = setTimeout(run, QUOTE_DEBOUNCE_MS);
    const refresh = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, assetKey(fromRef), assetKey(toRef), enabled, store.account, target, xDest?.assetId, recipient, fromListed, mainnet]);

  // Swap the two sides (and any quote, which no longer applies). Only on Stellar:
  // a cross-chain swap leaves Stellar, it does not come back to it here.
  const invert = () => {
    setFromRef(toRef);
    setToRef(fromRef);
    setQuote(null);
  };

  const quoteRows: [string, string][] = crossChain
    ? xQuote
      ? [
          [t('swap.feeRate'), feePct !== null ? `${trim(feePct, 2)}%` : '—'],
          [t('swap.fee'), `${trim(parseFloat(xQuote.fee.amount) || 0, 4)} ${xQuote.fee.asset}`],
          [t('swap.receiveEst'), `${trim(parseFloat(xQuote.destination.amount) || 0, 4)} ${xQuote.destination.asset}`],
          [t('swap.minReceived'), `${trim(parseFloat(xQuote.destination.minimum) || 0, 4)} ${xQuote.destination.asset}`],
          [t('xswap.eta'), `~${xQuote.timeEstimateSeconds} s`],
        ]
      : []
    : quote
      ? [
          [t('swap.feeRate'), feePct !== null ? `${trim(feePct, 2)}%` : '—'],
          [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 4)} ${gatewayAssetLabel(quote.fee.asset)}`],
          [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 4)} ${quote.destination.asset}`],
          [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 4)} ${quote.destination.asset}`],
        ]
      : [];

  const originPicker = (
    <div className="swap-target" role="group" aria-label={t('xswap.payFrom')}>
      <div className="swap-target-label">{t('xswap.payFrom')}</div>
      {ORIGINS.map((c) => (
        <button key={c} className={cx('swap-target-btn', origin === c && 'is-on')} onClick={() => setOrigin(c)}>
          {t(`xswap.chain.${c}`)}
        </button>
      ))}
    </div>
  );

  if (origin !== 'stellar') {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={t('swap.title')} onBack={store.goBack} />
        <ChainSwap store={store} origin={origin} header={originPicker} />
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      <BackBar title={t('swap.title')} onBack={store.goBack} />

      {originPicker}

      <div className="swap-target" role="group" aria-label={t('xswap.receiveOn')}>
        <div className="swap-target-label">{t('xswap.receiveOn')}</div>
        {TARGETS.map((c) => (
          <button key={c} className={cx('swap-target-btn', target === c && 'is-on')} onClick={() => setTarget(c)}>
            {t(`xswap.chain.${c}`)}
          </button>
        ))}
      </div>

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
          {!crossChain && <button onClick={invert} aria-label="invert" className="swap-invert">⇅</button>}
        </div>
        <div className={cx('glass exchange-card exchange-card--to', openSel === 'to' && 'is-active')}>
          <div className="exchange-label">{t('swap.receiveEst')}{crossChain ? ` · ${t(`xswap.chain.${target}`)}` : ''}</div>
          <div className="row between g10">
            {crossChain ? (
              <div className="swap-dest-chips">
                {destOptions.map((a) => (
                  <button key={a.assetId} className={cx('swap-target-btn', xDest?.assetId === a.assetId && 'is-on')} onClick={() => setXDestId(a.assetId)}>
                    {a.symbol}
                  </button>
                ))}
              </div>
            ) : (
              <AssetSelect assets={assets} value={toRef} onPick={(a) => setToRef({ code: a.code, issuer: a.issuer })} open={openSel === 'to'} onToggle={(n) => setOpenSel(n ? 'to' : null)} />
            )}
            <div className={cx('swap-receive', !receive && 'is-empty')}>{receive ? trim(receive, 4) : '—'}</div>
          </div>
          {rate !== null && (
            <div className="swap-rate">
              1 {fromRef.code} ≈ {trim(rate, rate < 1 ? 6 : 4)} {receiveCode}
            </div>
          )}
          {crossChain && recipient && (
            <div className="swap-rate">
              {t('xswap.to')}: {recipient.slice(0, 6)}…{recipient.slice(-6)}
            </div>
          )}
        </div>
      </div>

      {/* Cross-chain guards: network, an address on the target, and a source NEAR lists. */}
      {crossChain && !mainnet && <div className="exchange-guard">{t('xswap.mainnetOnly')}</div>}
      {crossChain && mainnet && !recipient && (
        <div className="exchange-guard">{t('xswap.noAddress', { chain: t(`xswap.chain.${target}`) })}</div>
      )}
      {crossChain && mainnet && recipient && stellarListed.length > 0 && !fromListed && (
        <div className="exchange-guard">{t('xswap.unsupportedFrom', { list: stellarListed.map((a) => a.symbol).join(', ') })}</div>
      )}

      {/* Same-asset guard. */}
      {enabled && !crossChain && sameAsset && (
        <div className="exchange-guard">{t('swap.sameAsset')}</div>
      )}

      {/* Insufficient-balance guard (reserve-aware for XLM). */}
      {enabled && (crossChain || !sameAsset) && insufficient && (
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
      {quoteRows.length > 0 && (
        <div className="glass exchange-quote">
          {quoteRows.map(([label, val]) => (
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
          {crossChain ? t('xswap.note', { chain: t(`xswap.chain.${target}`) }) : t('swap.note2')}
        </div>
      )}

      {/* On the shared key: say what it costs and what an account would change.
          The percentage shown in the rows above is always the gateway's own
          number from the quote — this is the offer, not the price. */}
      {enabled && store.publicAccess && (
        <div className="glass exchange-note">
          {t('swap.publicRate')}
        </div>
      )}

      <div className="spacer" />
      {enabled ? (
        // The quote travels with the submit: the guard bounds the envelope by what THIS
        // card showed (pay, and the "minimum received" row), never by the create
        // response that carries the XDR.
        <div className="kb-dock">
          {crossChain ? (
            <PrimaryButton
              disabled={store.busy || !canCrossSwap}
              onClick={() => from && xDest && xQuote && store.submitCrossChain(pay, from, target as CrossChainTarget, xDest, xQuote)}
            >
              {store.busy ? <Spinner /> : t('swap.cta')}
            </PrimaryButton>
          ) : (
            <PrimaryButton disabled={store.busy || !canSwap} onClick={() => from && to && quote && store.submitSwap(pay, from, to, quote)}>
              {store.busy ? <Spinner /> : t('swap.cta')}
            </PrimaryButton>
          )}
        </div>
      ) : (
        // No credential at all: the platform was unreachable and this build shipped
        // no compiled-in public key. Falling back to the account flow is right —
        // it is the one path that does not depend on that fetch.
        <EnableReceivingCard store={store} />
      )}
    </div>
  );
}
