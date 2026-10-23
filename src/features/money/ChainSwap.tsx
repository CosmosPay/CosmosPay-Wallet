import { useEffect, useState, type ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Icon } from '@/ui/Icon';
import { AssetLogo } from '@/ui/AssetLogo';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { CROSS_CHAIN_SLIPPAGE_BPS, QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import { CHAIN_SWAP_SLIPPAGE_BPS, CHAIN_TOKENS, NATIVE_RESERVE, type ChainToken, type OtherChain } from '@/constants/chains';
import type { CrossChainAsset, CrossChainQuote, SwapQuote } from '@/lib/cosmospay';
import { networkEnv } from '@/lib/stellar';
import { NetworkPicker } from '@/features/money/NetworkPicker';
import { SwapRouteBadge } from '@/features/money/SwapRouteBadge';
import { SlippageControl } from '@/features/money/SlippageControl';
import { SwapProgress } from '@/features/money/SwapProgress';
import { slippageFor } from '@/lib/slippage';
import { intentsListsToken, intentsTargets, swapRoute, swapTargets, venueFallback, type SwapNetwork } from '@/lib/swapRoute';
import { fromMinorUnits, parseDecimalOr0, sanitizeDecimalInput, toMinorUnitsBig } from '@/lib/amount';

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * The swap screen when it pays from one of the other chains. The route is the table in
 * `lib/swapRoute.ts`: on Solana and Monad a swap that stays on the chain is a Jupiter /
 * Kuru Flow swap the gateway builds and the wallet checks and signs; everything else —
 * a swap to another chain, Stellar included, and a swap that stays on Ethereum, Arbitrum
 * or Base — is a NEAR Intents swap the wallet funds with a transfer it builds itself.
 * Either way both ends are this phrase's own addresses.
 *
 * `header` is the "Pay from" selector, owned by `Swap`, which renders this screen.
 */
export function ChainSwap({ store, origin, header }: { store: WalletStore; origin: OtherChain; header: ReactNode }) {
  const t = store.t;
  const tokens = CHAIN_TOKENS[origin];
  const targets = swapTargets(origin);
  const [fromAsset, setFromAsset] = useState(tokens[0].asset);
  const [target, setTarget] = useState<SwapNetwork>(targets[0]);
  const [toAsset, setToAsset] = useState(tokens[1]?.asset ?? tokens[0].asset);
  const [xDestId, setXDestId] = useState<string | null>(null);
  const [xAssets, setXAssets] = useState<CrossChainAsset[]>([]);
  const [pay, setPay] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [xQuote, setXQuote] = useState<CrossChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // NEAR Intents declined to quote this pair or amount: a standing line, not a toast per refresh.
  const [xRefused, setXRefused] = useState(false);
  // Jupiter / Kuru Flow did not answer a quote for this pair: it goes to NEAR Intents instead.
  const [venueDown, setVenueDown] = useState(false);

  // Switching chains resets what only made sense on the previous one.
  useEffect(() => {
    setFromAsset(tokens[0].asset);
    setToAsset(tokens[1]?.asset ?? tokens[0].asset);
    setTarget(swapTargets(origin)[0]);
    setPay('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);
  // A venue that timed out is asked again on the next pair rather than written off.
  useEffect(() => setVenueDown(false), [origin, target]);

  const nativeRoute = swapRoute(origin, target);
  const fallback = venueDown && venueFallback(nativeRoute) === 'intents';
  const route = fallback ? 'intents' : nativeRoute;
  // A venue swap (Jupiter / Kuru) is built by the gateway; anything else is NEAR Intents.
  const venue = route === 'jupiter' || route === 'kuru';
  const from: ChainToken = tokens.find((tk) => tk.asset === fromAsset) ?? tokens[0];
  const sameOptions = tokens.filter((tk) => tk.asset !== from.asset);
  const to = sameOptions.find((tk) => tk.asset === toAsset) ?? sameOptions[0];

  const enabled = store.gatewayAccess;
  const mainnet = networkEnv(store.network) === 'prod';
  const owner = store.chainAddress(origin);
  const recipient = target === origin ? owner : store.chainAddress(target);
  const chainName = (c: SwapNetwork) => t(`xswap.chain.${c}`);

  // Balances on the origin chain; reloaded after each swap (busy → false).
  useEffect(() => {
    store.ensureChainAddresses();
    if (!owner || !mainnet) return;
    let cancelled = false;
    setBalances(undefined);
    store.chainBalances(origin).then((b) => { if (!cancelled) setBalances(b); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, owner, mainnet, store.busy]);

  useEffect(() => {
    if (venue || xAssets.length) return;
    let cancelled = false;
    store.crossChainAssets().then((list) => { if (!cancelled) setXAssets(list); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  // On a same-chain NEAR swap the token being sold is not something to receive.
  const destOptions: CrossChainAsset[] = venue
    ? []
    : (intentsTargets(target, xAssets) as CrossChainAsset[]).filter(
        (a) => !(target === origin && (from.asset === 'native' ? a.contract === null : a.contract?.toLowerCase() === from.asset.toLowerCase())),
      );
  const xDest = destOptions.find((a) => a.assetId === xDestId) ?? destOptions[0] ?? null;
  // NEAR Intents can only be paid with a token it lists on this chain — and only on a chain
  // the swap server serves at all, which an older deployment may not.
  const originServed = venue || xAssets.length === 0 || xAssets.some((a) => a.chain === origin);
  const targetServed = venue || xAssets.length === 0 || xAssets.some((a) => a.chain === target);
  const payListed = venue || xAssets.length === 0 || !originServed || intentsListsToken(origin, from, xAssets);

  const balance = balances?.[from.asset] ?? 0n;
  const reserve = from.asset === 'native' ? NATIVE_RESERVE[origin] : 0n;
  const avail = balance > reserve ? balance - reserve : 0n;
  const units = toMinorUnitsBig(pay, from.decimals);
  const insufficient = !!units && units > avail;
  const ready =
    enabled && mainnet && !!owner && !!recipient && !!units && units > 0n && !insufficient && payListed && originServed && targetServed;
  const payNum = parseDecimalOr0(pay);

  useEffect(() => {
    setQuote(null);
    setXQuote(null);
    setXRefused(false);
  }, [pay, from.asset, to?.asset, target, xDest?.assetId, store.slippageBps, venue]);

  useEffect(() => {
    if (!ready || (venue ? !to : !xDest)) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      if (!venue) {
        const q = await store.quoteCrossChainFrom(origin, pay, from, xDest!, fallback);
        if (cancelled) return;
        setQuoting(false);
        setXRefused(q === 'refused');
        if (q && q !== 'refused') setXQuote(q);
      } else {
        const q = await store.quoteChainSwap(origin as 'solana' | 'monad', pay, from, to!);
        if (cancelled) return;
        setQuoting(false);
        if (q === 'unavailable') setVenueDown(true);
        else if (q) setQuote(q);
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
  }, [ready, pay, from.asset, to?.asset, target, xDest?.assetId, store.slippageBps, venue]);

  const receive = !venue
    ? xQuote ? parseFloat(xQuote.destination.amount) || 0 : 0
    : quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  const receiveCode = !venue ? xDest?.symbol ?? '' : to?.symbol ?? '';
  const rate = receive > 0 && payNum > 0 ? receive / payNum : null;
  const human = (v: bigint) => trim(parseFloat(fromMinorUnits(v, from.decimals) ?? '0') || 0, 6);

  const rows: [string, string][] = !venue
    ? xQuote
      ? [
          [t('swap.feeRate'), `${trim(xQuote.fee.bps / 100, 2)}%`],
          [t('swap.fee'), `${trim(parseFloat(xQuote.fee.amount) || 0, 6)} ${xQuote.fee.asset}`],
          [t('swap.receiveEst'), `${trim(parseFloat(xQuote.destination.amount) || 0, 6)} ${xQuote.destination.asset}`],
          [t('swap.minReceived'), `${trim(parseFloat(xQuote.destination.minimum) || 0, 6)} ${xQuote.destination.asset}`],
          [t('slippage.title'), `${trim(slippageFor(store.slippageBps, CROSS_CHAIN_SLIPPAGE_BPS) / 100, 2)}%`],
          [t('xswap.eta'), `~${xQuote.timeEstimateSeconds} s`],
        ]
      : []
    : quote && to
      ? [
          [t('swap.feeRate'), `${trim(quote.fee.bps / 100, 2)}%`],
          [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 6)} ${to.symbol}`],
          [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 6)} ${to.symbol}`],
          [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 6)} ${to.symbol}`],
          [t('slippage.title'), `${trim(quote.destination.slippageBps / 100, 2)}%`],
        ]
      : [];

  const canSubmit = ready && !store.busy && (!venue ? !!xDest && !!xQuote : !!to && !!quote);
  const submit = () => {
    if (!venue) {
      if (xDest && xQuote) store.submitCrossChainFrom(origin, pay, from, xDest, xQuote, fallback);
    } else if (to && quote) {
      store.submitChainSwap(origin as 'solana' | 'monad', pay, from, to, quote);
    }
  };

  const note = !venue
    ? target === origin
      ? t('xswap.noteSameChain', { chain: chainName(origin) })
      : t('xswap.noteFrom', { origin: chainName(origin), chain: chainName(target) })
    : t(origin === 'solana' ? 'xswap.noteSolana' : 'xswap.noteMonad');
  const tokenChip = (tk: ChainToken, on: boolean, pick: () => void) => (
    <button key={tk.asset} type="button" className={cx('chip', on && 'is-on')} onClick={pick}>
      <AssetLogo code={tk.symbol} size={20} />
      {tk.symbol}
    </button>
  );

  return (
    <>
      {header}
      <NetworkPicker store={store} label={t('xswap.receiveOn')} value={target} options={targets} onPick={setTarget} />

      <div className="exchange-stack">
        <div className="exchange-card">
          <div className="exchange-label-row">
            <span className="exchange-label">
              {t('swap.pay')} · {chainName(origin)}
            </span>
            <button type="button" className="exchange-max" onClick={() => setPay(fromMinorUnits(avail, from.decimals) ?? '')}>
              {t('swap.balance')}: {balances === undefined && owner && mainnet ? '…' : human(balance)} {from.symbol}
              <span className="exchange-max-tag">MAX</span>
            </button>
          </div>
          <div className="row between g10">
            <div className="swap-dest-chips">{tokens.map((tk) => tokenChip(tk, from.asset === tk.asset, () => setFromAsset(tk.asset)))}</div>
            <input
              value={pay}
              placeholder="0"
              onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setPay(v); }}
              inputMode="decimal"
              aria-label={t('swap.pay')}
              className="exchange-input swap-pay-input"
            />
          </div>
          {reserve > 0n && <div className="swap-rate">{t('xswap.reserve', { amount: human(reserve), code: from.symbol })}</div>}
        </div>
        <div className="swap-seam">
          <span className="swap-invert" aria-hidden="true">
            <Icon name="arrow-down" size={20} />
          </span>
        </div>
        <div className="exchange-card exchange-card--to">
          <div className="exchange-label-row">
            <span className="exchange-label">
              {t('swap.receiveEst')} · {chainName(target)}
            </span>
          </div>
          <div className="row between g10">
            <div className="swap-dest-chips">
              {!venue
                ? destOptions.map((a) => (
                    <button key={a.assetId} type="button" className={cx('chip', xDest?.assetId === a.assetId && 'is-on')} onClick={() => setXDestId(a.assetId)}>
                      <AssetLogo code={a.symbol} size={20} />
                      {a.symbol}
                    </button>
                  ))
                : sameOptions.map((tk) => tokenChip(tk, to?.asset === tk.asset, () => setToAsset(tk.asset)))}
            </div>
            <div key={receive} className={cx('swap-receive', !receive && 'is-empty')}>{receive ? trim(receive, 6) : '—'}</div>
          </div>
          {rate !== null && (
            <div className="swap-rate">
              1 {from.symbol} ≈ {trim(rate, rate < 1 ? 6 : 4)} {receiveCode}
            </div>
          )}
          {recipient && (
            <div className="swap-rate">
              {t('xswap.to')}: {shortAddr(recipient)}
            </div>
          )}
        </div>
      </div>

      {route && <SwapRouteBadge store={store} route={route} quoting={enabled && quoting} />}
      {fallback && nativeRoute && (
        <div className="exchange-guard">{t('xswap.venueDown', { venue: t(`swap.venue.${nativeRoute}`) })}</div>
      )}
      {route && enabled && mainnet && (
        <SlippageControl store={store} venueDefault={venue ? CHAIN_SWAP_SLIPPAGE_BPS : CROSS_CHAIN_SLIPPAGE_BPS} />
      )}

      {!mainnet && <div className="exchange-guard">{t('xswap.mainnetOnly')}</div>}
      {!venue && xRefused && <div className="exchange-guard">{t('xswap.refused')}</div>}
      {mainnet && !owner && <div className="exchange-guard">{t('xswap.noAddress', { chain: chainName(origin) })}</div>}
      {mainnet && owner && target !== origin && !recipient && (
        <div className="exchange-guard">{t('xswap.noAddress', { chain: chainName(target) })}</div>
      )}
      {mainnet && owner && balances === null && (
        <div className="exchange-guard">{t('xswap.balanceError', { chain: chainName(origin) })}</div>
      )}
      {mainnet && !originServed && <div className="exchange-guard">{t('xswap.chainUnavailable', { chain: chainName(origin) })}</div>}
      {mainnet && originServed && !targetServed && (
        <div className="exchange-guard">{t('xswap.chainUnavailable', { chain: chainName(target) })}</div>
      )}
      {mainnet && !payListed && <div className="exchange-guard">{t('xswap.unlistedPay', { code: from.symbol, chain: chainName(origin) })}</div>}
      {insufficient && (
        <div className="exchange-guard exchange-guard--danger">
          {t('swap.insufficient', { avail: human(avail), code: from.symbol })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="exchange-quote">
          {rows.map(([label, val]) => (
            <div key={label} className="exchange-quote-row">
              <span className="exchange-quote-label">{label}</span>
              <span className="exchange-quote-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {enabled && <div className="exchange-note">{note}</div>}
      {enabled && store.publicAccess && <div className="exchange-note">{t('swap.publicRate')}</div>}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!canSubmit} onClick={submit}>
          {store.busy ? <Spinner /> : t('swap.cta')}
        </PrimaryButton>
      </div>

      {store.busy && receiveCode && (
        <SwapProgress
          store={store}
          from={{ code: from.symbol, amount: pay, chain: origin }}
          to={{ code: receiveCode, amount: receive ? trim(receive, 6) : '—', chain: target }}
        />
      )}
    </>
  );
}
