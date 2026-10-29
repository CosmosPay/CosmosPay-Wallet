import { useEffect, useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { PrimaryButton } from '@/ui/Buttons';
import { Dropdown } from '@/ui/Dropdown';
import { Spinner } from '@/ui/Spinner';
import { ChevronDownIcon, ExchangeIcon, GearIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import { fmt, trim } from '@/lib/format';
import { isDesktopLayout } from '@/lib/layout';
import { fromMinorUnits, sanitizeDecimalInput } from '@/lib/amount';
import { spendableXlm } from '@/lib/balances';
import { registrySnapshot } from '@/lib/assetRegistry';
import { DEFAULT_SLIPPAGE_BPS, type CrossChainQuote, type SwapQuote } from '@/lib/cosmospay';
import { buildSwapCatalog, canPayWith, estimateOut, receivableFrom, routeFor, type SwapRoute, type SwapToken } from '@/lib/swapCatalog';
import { SwapTokenPicker, TokenMark } from '@/features/money/SwapTokenPicker';
import { CHAIN_SWAP_SLIPPAGE_BPS, CHAIN_TOKENS_BY_NET, NATIVE_RESERVE, type ChainToken } from '@/constants/chains';
import { CROSS_CHAIN_SLIPPAGE_BPS, QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import { NETWORKS, SEND_FEE_RESERVE, type NetworkId, type NetworkToken } from '@/constants/networks';
import '@/styles/features/money/swap.css';

/** Slippage choices in basis points; '' is the route's own default (Auto). */
const SLIPPAGES = ['', '50', '100', '200'] as const;
type Slippage = (typeof SLIPPAGES)[number];

type Quoted = { kind: 'dex'; q: SwapQuote } | { kind: 'near'; q: CrossChainQuote };
type QuoteState = { status: 'idle' | 'loading' | 'ready' | 'error'; data: Quoted | null; error: string; key: string };

const LEGACY = (c: NetworkId): c is 'solana' | 'monad' => c === 'solana' || c === 'monad';

/* ------------------------------- SWAP ------------------------------- */
/**
 * Swap, the way the developer platform's swap works (its SwapWidget): "You pay" and "You receive"
 * panels — a big amount and a token button naming its network — a flip between them, the quote
 * following the amount and tokens on its own, its details folded under the rate, the slippage in
 * the header's settings, and one button whose words say what is missing.
 *
 * Every token on every network (lib/swapCatalog.ts): Stellar, Solana and Monad through their own
 * market; everything else, and every pair across networks, through NEAR Intents (a deposit
 * address the wallet pays from its own address). The wallet pays from networks it signs on and
 * receives on its own address — wherever the output lands is this wallet's. A test network swaps
 * on Stellar's market only. The flows, their checks and signatures are the store's.
 */
export function Swap({ store }: { store: WalletStore }) {
  const t = store.t;
  const env = store.chainNet;
  const { loadIntentsAssets, setSwapOrigin, addressOn } = store;
  useEffect(() => {
    void loadIntentsAssets();
  }, [loadIntentsAssets]);

  // Stellar's assets: the registry's verified ones and whatever the account holds, XLM always.
  const stellar = useMemo(() => {
    const out: { code: string; issuer: string | null; issuerName: string | null }[] = [{ code: 'XLM', issuer: null, issuerName: null }];
    const seen = new Set(['XLM:']);
    const add = (code: string, issuer: string | null, issuerName: string | null) => {
      const k = `${code}:${issuer ?? ''}`;
      if (!seen.has(k)) (seen.add(k), out.push({ code, issuer, issuerName }));
    };
    for (const b of store.account?.balances ?? []) if (!b.isNative) add(b.code, b.issuer, null);
    for (const a of registrySnapshot(store.network.id)) if (a.verified && a.issuer) add(a.code, a.issuer, a.issuerName);
    return out;
  }, [store.account, store.network.id]);

  const catalog = useMemo(
    () => buildSwapCatalog({ intents: store.intentsAssets, env, stellar, chainTokens: CHAIN_TOKENS_BY_NET[env] }),
    [store.intentsAssets, env, stellar],
  );
  const signs = (c: NetworkId) => !!addressOn(c) && (c === 'stellar' || LEGACY(c) || NETWORKS[c].send);
  const receives = (c: NetworkId) => !!addressOn(c);
  const payable = useMemo(() => catalog.filter((x) => canPayWith(x, signs)), [catalog, addressOn]);

  // What the wallet holds of a token, in its units (null: nothing, or not read).
  const unitsOf = (tk: SwapToken): number | null => {
    if (tk.chain === 'stellar') {
      const b = store.account?.balances.find((x) => x.code === tk.symbol && (x.isNative ? null : x.issuer) === tk.contract);
      return b ? parseFloat(b.balance) || 0 : null;
    }
    const held = LEGACY(tk.chain) ? store.chainHoldings?.[tk.chain] : store.networkHoldings?.[tk.chain];
    if (!held) return null;
    const asset = tk.contract === null ? 'native' : NETWORKS[tk.chain].address === 'evm' ? tk.contract.toLowerCase() : tk.contract;
    const units = held[asset] ?? held[tk.contract ?? 'native'];
    return units === undefined ? null : parseFloat(fromMinorUnits(units, tk.decimals) ?? '0') || 0;
  };
  const heldOf = (tk: SwapToken) => {
    const n = unitsOf(tk);
    return n !== null && n > 0 ? trim(n, 6) : null;
  };
  // What can be paid: XLM keeps its reserve, a network's coin its fee reserve.
  const spendable = (tk: SwapToken): number => {
    const n = unitsOf(tk) ?? 0;
    if (tk.chain === 'stellar') return tk.contract === null ? spendableXlm(store.account) : n;
    if (tk.contract !== null) return n;
    const reserve = LEGACY(tk.chain) ? NATIVE_RESERVE[tk.chain] : SEND_FEE_RESERVE[tk.chain] ?? 0n;
    return Math.max(0, n - (parseFloat(fromMinorUnits(reserve, tk.decimals) ?? '0') || 0));
  };

  // The pair: XLM to USDC on Stellar by default — the one that works on both networks — or the
  // coin of the network a Home holding opened from.
  const [fromKey, setFromKey] = useState<string | null>(null);
  const [toKey, setToKey] = useState<string | null>(null);
  const opened = useRef(store.swapOrigin);
  useEffect(() => {
    setSwapOrigin('stellar');
  }, [setSwapOrigin]);
  useEffect(() => {
    if (!catalog.length) return;
    setFromKey((k) =>
      k && payable.some((x) => x.key === k)
        ? k
        : (payable.find((x) => x.chain === opened.current && x.contract === null) ?? payable.find((x) => x.chain === 'stellar' && x.contract === null))?.key ?? null,
    );
  }, [catalog, payable]);
  const from = payable.find((x) => x.key === fromKey) ?? null;
  const receivable = useMemo(() => (from ? receivableFrom(from, catalog, env, receives) : []), [from, catalog, env, addressOn]);
  useEffect(() => {
    if (!from) return;
    setToKey((k) =>
      k && receivable.some((x) => x.key === k)
        ? k
        : (receivable.find((x) => x.chain === from.chain && x.symbol === 'USDC') ?? receivable.find((x) => x.symbol === 'USDC') ?? receivable[0])?.key ?? null,
    );
  }, [from, receivable]);
  const to = receivable.find((x) => x.key === toKey) ?? null;
  const route: SwapRoute | null = from && to ? routeFor(from, to, env) : null;

  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState<Slippage>('');
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [details, setDetails] = useState(false);
  const [inverse, setInverse] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const slipRef = useRef<HTMLButtonElement>(null);

  const amt = parseFloat(amount) || 0;
  const avail = from ? spendable(from) : 0;
  const insufficient = amt > 0 && amt > avail;
  const bps = (r: SwapRoute | null) =>
    slippage ? Number(slippage) : r?.kind === 'near' ? CROSS_CHAIN_SLIPPAGE_BPS : r?.kind === 'dex' && r.chain !== 'stellar' ? CHAIN_SWAP_SLIPPAGE_BPS : DEFAULT_SLIPPAGE_BPS;

  // The store's flows, by route and by where the swap pays from.
  const stellarRef = (tk: SwapToken) => ({ code: tk.symbol, issuer: tk.contract });
  const chainToken = (tk: SwapToken): ChainToken => ({ symbol: tk.symbol, asset: tk.contract ?? 'native', decimals: tk.decimals });
  const networkToken = (tk: SwapToken): NetworkToken =>
    tk.contract === null
      ? { symbol: tk.symbol, asset: 'native', decimals: tk.decimals }
      : NETWORKS[tk.chain].tokens.find((r) => r.asset.toLowerCase() === tk.contract!.toLowerCase()) ?? { symbol: tk.symbol, asset: tk.contract, decimals: tk.decimals };

  const fetchQuote = async (): Promise<Quoted | null> => {
    if (!from || !to || !route || route.kind === 'none') return null;
    const s = bps(route);
    if (route.kind === 'dex') {
      const q =
        route.chain === 'stellar'
          ? await store.quoteSwap(amount, stellarRef(from), stellarRef(to), s)
          : await store.quoteChainSwap(route.chain as 'solana' | 'monad', amount, chainToken(from), chainToken(to), s);
      return q ? { kind: 'dex', q } : null;
    }
    if (!to.near) return null;
    const q =
      from.chain === 'stellar'
        ? await store.quoteCrossChain(amount, stellarRef(from), to.chain, to.near, s)
        : LEGACY(from.chain)
          ? await store.quoteCrossChainFrom(from.chain, amount, chainToken(from), to.near, s)
          : await store.quoteCrossChainFromNetwork(from.chain, amount, networkToken(from), to.near, s);
    return q ? { kind: 'near', q } : null;
  };

  // The quote follows the inputs on its own, a moment after the last keystroke, and stays fresh
  // while it sits; an answer for inputs that have since changed is dropped.
  // Quoted whatever the balance, as swap apps do: the person sees what they would get, and the
  // button says what is missing.
  const quotable = !!route && route.kind !== 'none' && amt > 0 && store.gatewayAccess;
  const quoteKey = quotable && from && to ? JSON.stringify([from.key, to.key, amount, bps(route)]) : '';
  const [quote, setQuote] = useState<QuoteState>({ status: 'idle', data: null, error: '', key: '' });
  const latest = useRef('');
  const ask = (k: string) => {
    latest.current = k;
    setQuote((q) => ({ status: 'loading', data: q.key === k ? q.data : null, error: '', key: k }));
    fetchQuote()
      .then((data) => {
        if (latest.current === k) setQuote({ status: data ? 'ready' : 'error', data, error: data ? '' : t('swap.quoteError'), key: k });
      })
      .catch((e: unknown) => {
        if (latest.current === k) setQuote({ status: 'error', data: null, error: (e as Error).message || t('swap.quoteError'), key: k });
      });
  };
  useEffect(() => {
    if (!quoteKey) {
      latest.current = '';
      setQuote({ status: 'idle', data: null, error: '', key: '' });
      return;
    }
    const h = setTimeout(() => ask(quoteKey), QUOTE_DEBOUNCE_MS);
    const r = setInterval(() => ask(quoteKey), QUOTE_REFRESH_MS);
    return () => {
      clearTimeout(h);
      clearInterval(r);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const fresh = quote.key === quoteKey ? quote.data : null;
  const out = fresh ? (fresh.kind === 'dex' ? fresh.q.destination.estimated : fresh.q.destination.amount) : null;
  // Before the quote: NEAR Intents' listed prices.
  const estimate = !out && from && to ? estimateOut(amt, from, to) : null;
  const shownOut = out ?? (estimate !== null ? String(estimate) : '');
  const usd = (n: number | null) => (n === null || !Number.isFinite(n) ? null : `≈ $${fmt(n, 2)}`);
  const payUsd = from?.priceUsd && amt > 0 ? usd(amt * from.priceUsd) : null;
  const getUsd = to?.priceUsd && shownOut ? usd(Number(shownOut) * to.priceUsd) : null;
  const rate = shownOut && amt > 0 ? Number(shownOut) / amt : null;
  const venue = !route || route.kind === 'none' ? '' : route.kind === 'near' ? t('swapw.venue.near') : t(`swapw.venue.${route.chain}`);
  const num = (v: string | number, dp = 7) => trim(Number(v) || 0, dp);

  // The button: what is missing, or the action.
  const cta = (() => {
    if (!from || !to || !route) return { label: t('swapw.ctaSelect'), ok: false };
    if (route.kind === 'none') return { label: t(route.reason === 'same-token' ? 'swapw.ctaSame' : route.reason === 'mainnet-only' ? 'swapw.ctaMainnet' : 'swapw.ctaUnsupported'), ok: false };
    if (!store.gatewayAccess) return { label: t('swapw.ctaUnavailable'), ok: false };
    if (!amount.trim() || amt <= 0) return { label: t('swapw.ctaAmount'), ok: false };
    if (insufficient) return { label: t('swapw.ctaInsufficient', { code: from.symbol }), ok: false };
    if (quote.status === 'error' && quote.key === quoteKey) return { label: t('swapw.ctaRetry'), ok: true, retry: true };
    if (!fresh) return { label: t('swapw.ctaQuoting'), ok: false };
    return { label: route.kind === 'near' ? t('swapw.ctaNear') : t('swapw.ctaSwap', { venue }), ok: true };
  })();

  const submit = () => {
    if ('retry' in cta && cta.retry) return ask(quoteKey);
    if (!cta.ok || !from || !to || !route || !fresh || store.busy) return;
    const s = bps(route);
    if (fresh.kind === 'dex' && route.kind === 'dex') {
      if (route.chain === 'stellar') void store.submitSwap(amount, stellarRef(from), stellarRef(to), fresh.q, s);
      else void store.submitChainSwap(route.chain as 'solana' | 'monad', amount, chainToken(from), chainToken(to), fresh.q, s);
      return;
    }
    if (fresh.kind === 'near' && to.near) {
      if (from.chain === 'stellar') void store.submitCrossChain(amount, stellarRef(from), to.chain, to.near, fresh.q, s);
      else if (LEGACY(from.chain)) void store.submitCrossChainFrom(from.chain, amount, chainToken(from), to.near, fresh.q, s);
      else void store.submitCrossChainFromNetwork(from.chain, amount, networkToken(from), to.near, fresh.q, s);
    }
  };

  // Picking the received token to pay with swaps the two, as swap apps do; the other side stays
  // only while the pair still has a route.
  const pick = (tk: SwapToken) => {
    const side = picker;
    setPicker(null);
    if (side === 'from') {
      if (tk.key === toKey && from) setToKey(from.key);
      setFromKey(tk.key);
    } else {
      setToKey(tk.key);
    }
  };
  const flippable = !!to && payable.some((x) => x.key === to.key) && !!from && routeFor(to, from, env).kind !== 'none';
  const flip = () => {
    if (!flippable || !from || !to) return;
    setFlipped((f) => !f);
    setFromKey(to.key);
    setToKey(from.key);
    if (shownOut) setAmount(String(Number(Number(shownOut).toFixed(Math.min(7, to.decimals)))));
  };

  const tokenButton = (side: 'from' | 'to', tk: SwapToken | null) => (
    <button
      type="button"
      onClick={() => setPicker(side)}
      aria-haspopup="dialog"
      aria-label={tk ? t('swapw.changeToken', { token: tk.symbol, network: store.networkName(tk.chain) }) : t('swapw.selectToken')}
      className={cx('swapw-token', !tk && 'is-empty')}
    >
      {tk ? (
        <>
          <TokenMark token={tk} size="button" />
          <span className="swapw-token-text">
            <span className="swapw-token-sym">{tk.symbol}</span>
            <span className="swapw-token-net">{store.networkName(tk.chain)}</span>
          </span>
        </>
      ) : (
        <span className="swapw-token-sym">{t('swapw.selectToken')}</span>
      )}
      <ChevronDownIcon className="swapw-token-chev" />
    </button>
  );

  const slippageMenu = (
    <div className="swapw-slip">
      <button
        ref={slipRef}
        type="button"
        onClick={() => setSlipOpen((o) => !o)}
        aria-expanded={slipOpen}
        aria-label={t('swapw.settings')}
        title={t('swapw.settings')}
        className="swapw-slip-btn"
      >
        <GearIcon />
      </button>
      <Dropdown open={slipOpen} onClose={() => setSlipOpen(false)} anchorRef={slipRef} label={t('swapw.slippage')} className="swapw-slip-panel">
        <p className="swapw-slip-title" id="swapw-slip-title">
          {t('swapw.slippage')}
        </p>
        <div className="swapw-slip-options" role="group" aria-labelledby="swapw-slip-title">
          {SLIPPAGES.map((s) => (
            <button
              key={s || 'auto'}
              type="button"
              aria-pressed={slippage === s}
              onClick={() => {
                setSlippage(s);
                setSlipOpen(false);
              }}
              className={cx('swapw-slip-opt', slippage === s && 'is-on')}
            >
              {s ? `${Number(s) / 100}%` : t('swapw.slippageAuto')}
            </button>
          ))}
        </div>
      </Dropdown>
    </div>
  );

  return (
    <div className="scr screen col pb-24 swapw">
      <ScreenHeader title={t('swap.title')} onBack={store.goBack} right={slippageMenu} />

      <div className="swapw-panels">
        <div className="swapw-panel">
          <div className="swapw-panel-top">
            <label htmlFor="swapw-pay">{t('swapw.pay')}</label>
            {payUsd && <span className="swapw-usd">{payUsd}</span>}
          </div>
          <div className="swapw-panel-row">
            <input
              id="swapw-pay"
              value={amount}
              onChange={(e) => {
                const v = sanitizeDecimalInput((e.target as HTMLInputElement).value.replace(',', '.'));
                if (v !== null) setAmount(v);
              }}
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              aria-invalid={insufficient || undefined}
              className={cx('swapw-amount', insufficient && 'is-invalid')}
            />
            {tokenButton('from', from)}
          </div>
          {from && (
            <div className="swapw-panel-foot">
              <span>
                {t('swap.balance')}: {trim(avail, 6)} {from.symbol}
              </span>
              <button type="button" onClick={() => setAmount(String(Math.floor(avail * 1e6) / 1e6))} disabled={avail <= 0} className="swapw-max">
                {t('send.max')}
              </button>
            </div>
          )}
        </div>

        <button type="button" onClick={flip} disabled={!flippable} aria-label={t('swap.invert')} title={t('swap.invert')} className={cx('swapw-flip', flipped && 'is-turned')}>
          <ExchangeIcon />
        </button>

        <div className="swapw-panel is-get" aria-busy={quote.status === 'loading' || undefined}>
          <div className="swapw-panel-top">
            <span id="swapw-get">{t('swapw.receive')}</span>
            {getUsd && <span className="swapw-usd">{getUsd}</span>}
          </div>
          <div className="swapw-panel-row">
            <output aria-labelledby="swapw-get" aria-live="polite" className={cx('swapw-amount is-out', !shownOut && 'is-empty', !out && estimate !== null && 'is-estimate')}>
              {quote.status === 'loading' && !shownOut ? <Spinner size={18} tone="text" /> : shownOut ? `${!out ? '≈ ' : ''}${num(shownOut)}` : '0'}
            </output>
            {tokenButton('to', to)}
          </div>
          {to && <div className="swapw-panel-foot is-plain">{t('swapw.receiveOn', { network: store.networkName(to.chain) })}</div>}
        </div>
      </div>

      {rate !== null && from && to && (
        <div className={cx('swapw-quote', details && 'is-open')}>
          <div className="swapw-quote-head">
            <button type="button" onClick={() => setInverse((v) => !v)} title={t('swapw.invertRate')} className="swapw-rate">
              {inverse ? `1 ${to.symbol} = ${num(1 / rate, 8)} ${from.symbol}` : `1 ${from.symbol} = ${num(rate, 8)} ${to.symbol}`}
            </button>
            <button type="button" aria-expanded={details} aria-controls="swapw-details" onClick={() => setDetails((d) => !d)} className="swapw-quote-toggle">
              <span>{venue}</span>
              <ChevronDownIcon className={cx('swapw-quote-chev', details && 'is-open')} />
              <span className="sr-only">{t('swapw.details')}</span>
            </button>
          </div>
          <div id="swapw-details" className="swapw-quote-body" inert={!details}>
            <dl className="swapw-rows">
              {fresh && (
                <div>
                  <dt>{t('swapw.minimum')}</dt>
                  <dd>
                    {num(fresh.q.destination.minimum)} {to.symbol}
                  </dd>
                </div>
              )}
              {fresh && (
                <div>
                  <dt>{t('swap.fee')}</dt>
                  <dd>
                    {num(fresh.q.fee.amount)} {fresh.kind === 'near' ? fresh.q.fee.asset : from.symbol} ({fresh.q.fee.bps / 100}%)
                  </dd>
                </div>
              )}
              {fresh?.kind === 'near' && (
                <div>
                  <dt>{t('swapw.eta')}</dt>
                  <dd>{t('swapw.seconds', { n: fresh.q.timeEstimateSeconds })}</dd>
                </div>
              )}
              <div>
                <dt>{t('swapw.slippage')}</dt>
                <dd>{slippage ? `${Number(slippage) / 100}%` : `${t('swapw.slippageAuto')} · ${bps(route) / 100}%`}</dd>
              </div>
              <div>
                <dt>{t('swapw.route')}</dt>
                <dd>{venue}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      <div className="swapw-foot kb-dock">
        <PrimaryButton disabled={!cta.ok || store.busy} onClick={submit}>
          {store.busy ? <Spinner /> : cta.label}
        </PrimaryButton>
        {quote.status === 'error' && quote.key === quoteKey && quote.error && (
          <p className="swapw-error" role="alert">
            {quote.error}
          </p>
        )}
      </div>

      <SwapTokenPicker
        open={picker !== null}
        title={picker === 'to' ? t('swapw.pickReceive') : t('swapw.pickPay')}
        tokens={picker === 'to' ? receivable : payable}
        selectedKey={picker === 'to' ? toKey : fromKey}
        heldOf={heldOf}
        networkName={store.networkName}
        onPick={pick}
        onClose={() => setPicker(null)}
        desktop={isDesktopLayout()}
        labels={{
          search: t('home.searchAssets'),
          clear: t('common.clearSearch'),
          close: t('a11y.close'),
          held: t('swapw.held'),
          all: t('swapw.all'),
          none: t('send.noAsset'),
        }}
      />
    </div>
  );
}
