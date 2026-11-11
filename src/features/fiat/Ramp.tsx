import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Segmented } from '@/ui/Segmented';
import { Notice } from '@/ui/Notice';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { ArrowDownIcon, ChevronDownIcon, ExchangeIcon } from '@/ui/Icons';
import { Select } from '@/features/fiat/Select';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { CurrencyFlag, CurrencySheet, RampTokenMark, TokenSheet, type RampSheetNetwork } from '@/features/fiat/RampPickers';
import { RampOrders } from '@/features/fiat/RampOrders';
import { useKeptState } from '@/hooks/useKeptState';
import { KEPT_INPUT } from '@/constants/keptInputs';
import {
  RAMP_DEFAULT_CURRENCY,
  RAMP_FIAT_DECIMALS,
  RAMP_QUOTE_DEBOUNCE_MS,
  RAMP_SIDES,
  RAMP_USD_STABLES,
  type RampSide,
} from '@/constants/ramp';
import { ApiRequestError } from '@/lib/apiError';
import { cx } from '@/lib/cx';
import { shortAddr } from '@/lib/format';
import { isDesktopLayout } from '@/lib/layout';
import { isExtension } from '@/lib/platform';
import { openExternal, reserveExternalTab } from '@/lib/openExternal';
import { sanitizeDecimalInput } from '@/lib/amount';
import {
  currencyLabel,
  marketRate,
  methodLabel,
  orderKey,
  quoteRate,
  rampAmountProblem,
  rampEstimate,
  rampMinIn,
  rampNetworks,
  rampWalletNetwork,
  tokenUsd,
  type RampCurrency,
  type RampMarket,
  type RampOrder,
  type RampQuote,
  type RampSession,
  type RampToken,
} from '@/lib/p2pRamp';
import '@/styles/ui/swap-widget.css';
import '@/styles/features/fiat/ramp.css';

/** What a side's form keeps while the person walks away and back (`useKeptState`). */
interface RampDraft {
  currency: string;
  method: string;
  token: RampToken | null;
  amount: string;
}
const EMPTY_DRAFT: RampDraft = { currency: '', method: '', token: null, amount: '' };

type QuoteState = { status: 'idle' | 'loading' | 'ready' | 'error'; data: RampQuote | null; error: string; key: string };
const IDLE: QuoteState = { status: 'idle', data: null, error: '', key: '' };

/**
 * Buy or sell with local money (screen `ramp`): the developer platform's Fiat → On-ramp /
 * Off-ramp, over the same Cosmos Pay API (`lib/p2pRamp.ts`), drawn like the wallet's Swap.
 *
 * "You pay" and "You receive" panels — local money with its flag, a token with its network —
 * the market price under them, replaced by the firm quote once the order is complete, the
 * payment method, the wallet's own account on that network, and one button whose words say
 * what is missing. The button records the order and opens the hosted window that takes it;
 * the person signs in, verifies their identity and pays or gets paid there. A purchase
 * delivers to this wallet's address (fixed in that window); a sale is sent from it, which the
 * window asks a wallet to sign: Cosmos Wallet's browser extension answers it.
 */
export function Ramp({ store }: { store: WalletStore }) {
  const t = store.t;
  const [side, setSide] = useKeptState<RampSide>(KEPT_INPUT.rampSide, 'buy');
  const options = RAMP_SIDES.map((s) => ({ value: s, label: t(s === 'buy' ? 'ramp.buy' : 'ramp.sell') }));
  return (
    <div className="scr screen col pb-24 ramp">
      <ScreenHeader title={t('ramp.title')} desc={t(side === 'buy' ? 'ramp.descBuy' : 'ramp.descSell')} onBack={store.goBack} />
      <Segmented label={t('ramp.sideLabel')} options={options} value={side} onChange={setSide} className="ramp-sides" />
      <RampForm key={`${side}:${store.chainNet}`} store={store} side={side} />
    </div>
  );
}

function RampForm({ store, side }: { store: WalletStore; side: RampSide }) {
  const t = store.t;
  const env = store.chainNet;
  const lang = store.lang;
  const { ensureChainAddresses, addressOn, rampMarket, rampTokens, rampQuote, openRampSession } = store;
  const hasAccount = !store.publicAccess;
  const [draft, setDraft] = useKeptState<RampDraft>(`${KEPT_INPUT.rampDraft}.${side}.${env}`, EMPTY_DRAFT);
  const patch = (p: Partial<RampDraft>) => setDraft((d) => ({ ...d, ...p }));

  // undefined while it loads; an error when it could not be read ('account' when only an account may).
  const [market, setMarket] = useState<RampMarket | undefined>(undefined);
  const [marketError, setMarketError] = useState<null | 'account' | 'failed'>(null);
  const [attempt, setAttempt] = useState(0);
  const [picker, setPicker] = useState<null | 'currency' | 'token'>(null);
  const [details, setDetails] = useState(false);
  const [inverse, setInverse] = useState(false);
  const [quote, setQuote] = useState<QuoteState>(IDLE);
  const [firmOff, setFirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openError, setOpenError] = useState('');
  const [opened, setOpened] = useState<RampSession | null>(null);
  const [ordersRev, setOrdersRev] = useState(0);

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  useEffect(() => {
    let alive = true;
    setMarket(undefined);
    setMarketError(null);
    rampMarket(side)
      .then((m) => alive && setMarket(m))
      .catch((e) => {
        if (!alive) return;
        // The shared key is refused here when the deployment has not opened the market to it.
        const refused = e instanceof ApiRequestError && (e.status === 401 || e.status === 403);
        setMarketError(refused && !hasAccount ? 'account' : 'failed');
      });
    return () => {
      alive = false;
    };
  }, [rampMarket, side, attempt, hasAccount]);

  const networks: RampSheetNetwork[] = useMemo(() => {
    if (!market) return [];
    return rampNetworks(market, env, (id) => !!addressOn(id)).flatMap((n) => {
      const id = rampWalletNetwork(n.chainId, env);
      return id ? [{ chainId: n.chainId, id, name: store.networkName(id), tokenCount: n.tokenCount }] : [];
    });
  }, [market, env, addressOn, store.networkName]);

  // Defaults once the market is in: pesos when they trade, else the first currency; the token
  // kept from before when its network is still offered, else the market's own, else the first
  // stablecoin the first network lists — read from the list so it carries its price.
  const loadTokens = useCallback((s: RampSide, chainId: number, q: string, skip: number) => rampTokens(s, chainId, q, skip), [rampTokens]);
  useEffect(() => {
    if (!market) return;
    const ids = market.currencies.map((c) => c.id);
    if (!ids.includes(draft.currency)) patch({ currency: ids.includes(RAMP_DEFAULT_CURRENCY) ? RAMP_DEFAULT_CURRENCY : ids[0] ?? '', method: '' });
    if (draft.token && networks.some((n) => n.chainId === draft.token?.chainId)) return;
    let alive = true;
    const d = market.defaultToken;
    const start = networks.some((n) => n.chainId === d.chainId) ? d : null;
    const chainId = start?.chainId ?? networks[0]?.chainId;
    if (chainId === undefined) {
      patch({ token: null });
      return;
    }
    loadTokens(side, chainId, start?.address ?? '', 0)
      .then((page) => {
        if (!alive) return;
        const hit = start
          ? page.data.find((x) => x.address.toLowerCase() === start.address.toLowerCase())
          : page.data.find((x) => RAMP_USD_STABLES.includes(x.symbol)) ?? page.data[0];
        patch({ token: hit ?? start });
      })
      .catch(() => alive && start && patch({ token: start }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, networks]);

  const currencies = market?.currencies ?? [];
  const cur: RampCurrency | null = currencies.find((c) => c.id === draft.currency) ?? null;
  const method = cur?.paymentMethods.find((m) => m.id === draft.method) ?? cur?.paymentMethods[0] ?? null;
  const token = draft.token && networks.some((n) => n.chainId === draft.token?.chainId) ? draft.token : null;
  const net = token ? rampWalletNetwork(token.chainId, env) : null;
  const netName = net ? store.networkName(net) : '';
  const address = net ? addressOn(net) : null;
  const amount = draft.amount;

  const num = (v: number, max = 2) => new Intl.NumberFormat(lang, { maximumFractionDigits: max }).format(v);
  // Local money with its cents once it has any; a token with two decimals from 1 up, four
  // significant digits below (0.002231 ETH).
  const money = (v: number) => new Intl.NumberFormat(lang, { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  const units = (v: number) => (v >= 1 ? num(v, 2) : new Intl.NumberFormat(lang, { maximumSignificantDigits: 4 }).format(v));
  const nameOf = useCallback((c: RampCurrency) => currencyLabel(c.id, lang, c.name), [lang]);

  const problem = cur && token ? rampAmountProblem(side, amount, cur, token) : 'empty';
  const minIn = cur && token ? rampMinIn(side, cur, token) : null;
  const minText = minIn === null || !cur || !token ? '' : side === 'buy' ? `${money(minIn)} ${cur.id}` : `${tokenUsd(token) === 1 ? '' : '≈ '}${units(minIn)} ${token.symbol}`;
  const order: RampOrder | null =
    cur && method && token && address && problem === null
      ? { currency: cur.id, paymentMethod: method.id, chainId: token.chainId, token: token.address, amount: amount.trim(), address }
      : null;

  // The firm quote follows the order on its own, a moment after the last keystroke; an answer
  // for an order that has since changed is dropped. Only an account may ask for one.
  const quoteKey = order && hasAccount && !firmOff ? orderKey(order) : '';
  const latest = useRef('');
  useEffect(() => {
    latest.current = quoteKey;
    if (!quoteKey || !order) {
      setQuote(IDLE);
      return;
    }
    const k = quoteKey;
    const o = order;
    const timer = setTimeout(() => {
      setQuote({ status: 'loading', data: null, error: '', key: k });
      rampQuote(side, o)
        .then((data) => latest.current === k && setQuote({ status: 'ready', data, error: '', key: k }))
        .catch((e) => {
          if (latest.current !== k) return;
          // A deployment without the marketplace's integrator ids: keep the estimate, stop asking.
          if (e instanceof ApiRequestError && e.status === 503) {
            setFirmOff(true);
            setQuote(IDLE);
            return;
          }
          setQuote({ status: 'error', data: null, error: (e as Error).message || t('ramp.quoteFailed'), key: k });
        });
    }, RAMP_QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);
  const fresh = quote.status === 'ready' && quote.key === quoteKey ? quote.data : null;

  const estimate = cur && token && problem === null ? rampEstimate(side, amount, cur, token) : null;
  const out = fresh ? Number(fresh.amountOut) : estimate;
  const outText = out !== null ? `${fresh ? '' : '≈ '}${side === 'sell' ? money(out) : units(out)}` : '';
  const rate = fresh ? quoteRate(side, fresh) : cur && token ? marketRate(cur, token) : null;
  const unitOut = side === 'buy' ? token?.symbol ?? '' : cur?.id ?? '';

  // The button: what is missing, or the action.
  const cta = ((): { label: string; ok: boolean } => {
    if (!cur || !token) return { label: t('ramp.ctaNone'), ok: false };
    if (!amount.trim() || problem === 'empty') return { label: t('ramp.ctaAmount'), ok: false };
    if (problem === 'format') return { label: t('ramp.ctaAmountBad'), ok: false };
    if (problem === 'decimals') return { label: t('ramp.ctaDecimals', { n: token.decimals, token: token.symbol }), ok: false };
    if (problem === 'below-min') return { label: t('ramp.ctaMin', { min: minText }), ok: false };
    if (!address) return { label: t('ramp.ctaNoAddress', { network: netName }), ok: false };
    if (!hasAccount) return { label: t('ramp.ctaAccount'), ok: false };
    return { label: t(side === 'buy' ? 'ramp.ctaBuy' : 'ramp.ctaSell'), ok: true };
  })();

  const open = async () => {
    if (!cta.ok || !order || busy) return;
    // The tab is claimed while the tap is still on the stack, so a popup blocker lets it through.
    const tab = reserveExternalTab();
    setBusy(true);
    setOpenError('');
    try {
      const session = await openRampSession(side, order);
      const ok = await tab.open(session.widgetUrl);
      setOpened(session);
      setOrdersRev((r) => r + 1);
      patch({ amount: '' });
      store.flash(t(ok ? 'ramp.opened' : 'ramp.openBlocked'), ok ? 'ok' : 'info');
    } catch (e) {
      tab.cancel();
      setOpenError((e as Error).message || t('ramp.openFailed'));
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------- states ------------------------------- */

  if (marketError === 'account') {
    return (
      <div className="ramp-state col g12">
        <Notice>{store.meta?.email ? t('ramp.needAccount') : `${t('ramp.needAccount')} ${t('cosmospay.needEmail')}`}</Notice>
        {store.meta?.email && <EnableReceivingCard store={store} />}
      </div>
    );
  }
  if (marketError === 'failed') {
    return (
      <div className="ramp-state col g12">
        <Notice tone="danger">{t('ramp.loadFailed')}</Notice>
        <GhostButton onClick={() => setAttempt((a) => a + 1)}>{t('ramp.retry')}</GhostButton>
      </div>
    );
  }
  if (!market) {
    return (
      <div className="ramp-state center" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  if (currencies.length === 0 || networks.length === 0) {
    return <Notice className="ramp-state">{t(currencies.length === 0 ? 'ramp.noMarket' : 'ramp.noNetworks')}</Notice>;
  }

  /* -------------------------------- form -------------------------------- */

  const currencyButton = (
    <button
      type="button"
      onClick={() => setPicker('currency')}
      aria-haspopup="dialog"
      aria-expanded={picker === 'currency'}
      disabled={currencies.length < 2}
      aria-label={t('ramp.changeCurrency', { currency: cur ? nameOf(cur) : '' })}
      className="swapw-token"
    >
      {cur && <CurrencyFlag id={cur.id} size="button" />}
      <span className="swapw-token-text">
        <span className="swapw-token-sym">{cur?.id ?? '—'}</span>
        <span className="swapw-token-net">{cur ? nameOf(cur) : ''}</span>
      </span>
      {currencies.length > 1 && <ChevronDownIcon className="swapw-token-chev" />}
    </button>
  );
  const tokenButton = (
    <button
      type="button"
      onClick={() => setPicker('token')}
      aria-haspopup="dialog"
      aria-expanded={picker === 'token'}
      aria-label={token ? t('swapw.changeToken', { token: token.symbol, network: netName }) : t('swapw.selectToken')}
      className={cx('swapw-token', !token && 'is-empty')}
    >
      {token && net ? (
        <>
          <RampTokenMark token={token} network={net} size="button" />
          <span className="swapw-token-text">
            <span className="swapw-token-sym">{token.symbol}</span>
            <span className="swapw-token-net">{netName}</span>
          </span>
        </>
      ) : (
        <span className="swapw-token-sym">{t('swapw.selectToken')}</span>
      )}
      <ChevronDownIcon className="swapw-token-chev" />
    </button>
  );
  const badAmount = !!amount.trim() && problem !== null && problem !== 'empty';

  return (
    <form
      className="col"
      aria-label={t(side === 'buy' ? 'ramp.buy' : 'ramp.sell')}
      onSubmit={(event) => {
        event.preventDefault();
        if (picker === null) void open();
      }}
    >
      <div className="swapw-panels">
        <section className={cx('swapw-panel', badAmount && 'has-error')} aria-labelledby="ramp-pay-label">
          <div className="swapw-panel-top">
            <label id="ramp-pay-label" htmlFor="ramp-pay">
              {t('ramp.pay')}
            </label>
            {side === 'buy' ? currencyButton : tokenButton}
          </div>
          <div className="swapw-panel-row">
            <input
              id="ramp-pay"
              value={amount}
              onChange={(e) => {
                const decimals = side === 'buy' ? RAMP_FIAT_DECIMALS : token?.decimals ?? 18;
                const v = sanitizeDecimalInput(e.currentTarget.value, decimals, side === 'buy' ? 15 : 24);
                if (v !== null) patch({ amount: v });
              }}
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              aria-invalid={badAmount || undefined}
              aria-describedby={minText ? 'ramp-min' : undefined}
              className={cx('swapw-amount', badAmount && 'is-invalid')}
            />
          </div>
          {minText && (
            <div className="swapw-panel-foot is-plain">
              <span id="ramp-min">{t('ramp.min', { min: minText })}</span>
            </div>
          )}
        </section>

        <span className="ramp-seam" aria-hidden="true">
          <ArrowDownIcon />
        </span>

        <section className="swapw-panel is-get" aria-labelledby="ramp-get" aria-busy={quote.status === 'loading' || undefined}>
          <div className="swapw-panel-top">
            <span id="ramp-get">{t(fresh ? 'ramp.receive' : 'ramp.receiveAbout')}</span>
            {side === 'buy' ? tokenButton : currencyButton}
          </div>
          <div className="swapw-panel-row">
            <output aria-labelledby="ramp-get" aria-live="polite" className={cx('swapw-amount is-out', !outText && 'is-empty', !fresh && !!outText && 'is-estimate')}>
              {quote.status === 'loading' && !outText ? <Spinner size={18} tone="text" /> : outText || '0'}
            </output>
          </div>
          {net && (
            <div className="swapw-panel-foot is-plain">
              <span>
                {t(side === 'buy' ? 'ramp.arrivesOn' : 'ramp.leavesFrom', { network: netName })}
                {address ? ` · ${shortAddr(address, 6, 4)}` : ` · ${t('ramp.addressPending')}`}
              </span>
            </div>
          )}
        </section>
      </div>

      {rate !== null && cur && token && (
        <div className={cx('swapw-quote', details && fresh && 'is-open')}>
          <div className="swapw-quote-head">
            <button type="button" onClick={() => setInverse((v) => !v)} title={t('swapw.invertRate')} className="swapw-rate">
              <ExchangeIcon />
              {inverse ? `1 ${cur.id} = ${units(1 / rate)} ${token.symbol}` : `1 ${token.symbol} = ${num(rate, rate >= 100 ? 2 : 4)} ${cur.id}`}
            </button>
            {fresh ? (
              <button type="button" aria-expanded={details} aria-controls="ramp-details" onClick={() => setDetails((d) => !d)} className="swapw-quote-toggle">
                <span>{t('ramp.firm')}</span>
                <ChevronDownIcon className={cx('swapw-quote-chev', details && 'is-open')} />
              </button>
            ) : (
              <span className="ramp-quote-src">{t('ramp.marketPrice')}</span>
            )}
          </div>
          {fresh && (
            <div id="ramp-details" className="swapw-quote-body" inert={!details}>
              <dl className="swapw-rows">
                <div>
                  <dt>{t('ramp.fees')}</dt>
                  <dd>
                    {units(Number(fresh.fee.amountInToken))} {token.symbol} · {money(Number(fresh.fee.amountInFiat))} {cur.id}
                  </dd>
                </div>
                <div>
                  <dt>{t('ramp.atLeast')}</dt>
                  <dd>
                    {side === 'sell' ? money(Number(fresh.minAmountOut)) : units(Number(fresh.minAmountOut))} {unitOut}
                  </dd>
                </div>
                <div>
                  <dt>{t('ramp.validUntil')}</dt>
                  <dd>{new Date(fresh.expiresAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {cur && method && (
        <Select label={t(side === 'buy' ? 'ramp.methodBuy' : 'ramp.methodSell')} value={method.id} onChange={(id) => patch({ method: id })} className="ramp-method">
          {cur.paymentMethods.map((m) => (
            <option key={m.id} value={m.id}>
              {methodLabel(m.name, cur.id)}
            </option>
          ))}
        </Select>
      )}

      {!hasAccount && (
        <div className="ramp-account">
          {store.meta?.email ? <EnableReceivingCard store={store} /> : <Notice>{`${t('ramp.needAccount')} ${t('cosmospay.needEmail')}`}</Notice>}
        </div>
      )}

      <Notice className="ramp-note">
        {side === 'buy'
          ? t('ramp.noteBuy')
          : `${t('ramp.noteSell')} ${t(isExtension() ? 'ramp.sellConnectHere' : 'ramp.sellConnectBrowser', { address: address ? shortAddr(address, 6, 4) : '' })}`}
      </Notice>
      {env === 'testnet' && <Notice className="ramp-note">{t('ramp.testNote')}</Notice>}

      <div className="ramp-foot kb-dock">
        <span className="sr-only" role="status">
          {cta.label}
        </span>
        <PrimaryButton type="submit" disabled={!cta.ok || busy}>
          {busy ? <Spinner /> : cta.label}
        </PrimaryButton>
        {quote.status === 'error' && quote.key === quoteKey && quote.error && (
          <p className="swapw-error" role="alert">
            {quote.error}
          </p>
        )}
        {openError && (
          <p className="swapw-error" role="alert">
            {openError}
          </p>
        )}
        {opened && (
          <p className="ramp-reopen">
            {t('ramp.reopenHint')}{' '}
            <button type="button" className="link-btn" onClick={() => void openExternal(opened.widgetUrl)}>
              {t('ramp.reopen')}
            </button>
          </p>
        )}
      </div>

      {hasAccount && <RampOrders store={store} side={side} market={market} rev={ordersRev} />}

      <CurrencySheet
        open={picker === 'currency'}
        title={t(side === 'buy' ? 'ramp.pickCurrencyBuy' : 'ramp.pickCurrencySell')}
        currencies={currencies}
        selected={cur?.id ?? ''}
        nameOf={nameOf}
        asideOf={(c) => {
          const r = token ? marketRate(c, token) : null;
          return r && token ? `1 ${token.symbol} = ${num(r, r >= 100 ? 2 : 4)} ${c.id}` : null;
        }}
        onPick={(id) => {
          setPicker(null);
          patch({ currency: id, method: '' });
        }}
        onClose={() => setPicker(null)}
        desktop={isDesktopLayout()}
        labels={{ close: t('a11y.close'), search: t('ramp.searchCurrency'), clear: t('common.clearSearch'), none: t('ramp.noMatch') }}
      />
      <TokenSheet
        open={picker === 'token'}
        title={t(side === 'buy' ? 'ramp.pickTokenBuy' : 'ramp.pickTokenSell')}
        side={side}
        networks={networks}
        selected={token}
        load={loadTokens}
        onPick={(tk) => {
          setPicker(null);
          patch({ token: tk });
        }}
        onClose={() => setPicker(null)}
        desktop={isDesktopLayout()}
        labels={{
          close: t('a11y.close'),
          search: t('ramp.searchToken'),
          clear: t('common.clearSearch'),
          none: t('ramp.noMatch'),
          network: t('ramp.network'),
          pickNetwork: t('ramp.pickNetwork'),
          tokens: (n) => t('ramp.tokenCount', { n: num(n, 0) }),
          failed: t('ramp.tokensFailed'),
          retry: t('ramp.retry'),
          more: t('ramp.more'),
        }}
      />
    </form>
  );
}
