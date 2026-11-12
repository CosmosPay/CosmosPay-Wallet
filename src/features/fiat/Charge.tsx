import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Notice } from '@/ui/Notice';
import { Field } from '@/ui/Field';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { ArrowDownIcon, CheckIcon, ChevronDownIcon } from '@/ui/Icons';
import { EnableReceivingCard } from '@/features/cosmospay/EnableReceivingCard';
import { CurrencyFlag, CurrencySheet, RampTokenMark, TokenSheet, type RampSheetNetwork } from '@/features/fiat/RampPickers';
import { TransferAccountCard } from '@/features/fiat/TransferAccountCard';
import { useKeptState } from '@/hooks/useKeptState';
import { useCopied } from '@/hooks/useCopied';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { RAMP_FIAT_DECIMALS, RAMP_FIAT_MAX_DIGITS, type RampSide } from '@/constants/ramp';
import { CHARGE_BALANCE_POLL_MS, CHARGE_EXPIRES_MINUTES, CHARGE_POLL_MS } from '@/constants/qrCharge';
import { ApiRequestError } from '@/lib/apiError';
import { sanitizeDecimalInput } from '@/lib/amount';
import { cx } from '@/lib/cx';
import { shortAddr } from '@/lib/format';
import { isDesktopLayout } from '@/lib/layout';
import { qrDataUrl } from '@/lib/qr';
import { shareText } from '@/lib/share';
import {
  currencyLabel,
  marketRate,
  rampDefaultCurrency,
  rampEstimate,
  rampNetworks,
  rampTokenPick,
  rampTokenStart,
  rampWalletNetwork,
  type RampCurrency,
  type RampMarket,
  type RampToken,
} from '@/lib/p2pRamp';
import {
  chargeAmountProblem,
  chargeCancellable,
  chargeDescription,
  chargeMethodsKey,
  chargePaidMethodKey,
  chargePaidVia,
  chargeStatus,
  chargeTimeLeft,
  chargeUrlOk,
  chargeWatched,
  formatCountdown,
  sanitizeChargeDescription,
  type QrCharge,
} from '@/lib/qrCharge';
import '@/styles/ui/swap-widget.css';
import '@/styles/features/fiat/charge.css';

/** The payer's side of a charge is a purchase: the market, the token lists and the estimate are the buy side's. */
const BUY: RampSide = 'buy';

/** What the form keeps while the person walks away and back (`useKeptState`), per mode. */
interface ChargeDraft {
  currency: string;
  token: RampToken | null;
  amount: string;
  description: string;
}
const EMPTY_DRAFT: ChargeDraft = { currency: '', token: null, amount: '', description: '' };

/** Local money with its cents once it has any; a token with two decimals from 1 up, four significant digits below. */
function formatters(lang: string) {
  const money = (v: number) => new Intl.NumberFormat(lang, { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  const units = (v: number) =>
    v >= 1 ? new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(v) : new Intl.NumberFormat(lang, { maximumSignificantDigits: 4 }).format(v);
  return { money, units };
}

/** Whether the page is in view: the screen asks the API and the balance only then. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * Charge with QR (screen `charge`): the seller asks for an amount of local money and shows the QR
 * of a hosted page; whoever scans it pays the ways the request lists — a bank transfer, or a
 * local method through the same P2P purchase the ramp opens — and the token arrives in this
 * wallet's own EVM account. Rules in `lib/qrCharge.ts`, the charge and its calls in
 * `state/useQrCharge.ts`.
 *
 * Step one is the form, drawn like the ramp's purchase: the local money with its flag, the amount,
 * the token and network it arrives as (only networks this wallet holds, the ramp's defaults), an
 * optional one-line description and the estimate at the market price. Step two is the QR, the
 * amount, the estimate, how the customer can pay, the countdown, share and cancel, and it watches
 * for the payment two ways — the API's answer about the request, and this wallet's own balance of
 * the token — whichever says so first turns it into "payment received". A bank transfer the API
 * has received but not yet credited reads "processing" in between: no QR, no cancel, still
 * watched.
 */
export function Charge({ store }: { store: WalletStore }) {
  const t = store.t;
  const { qrCharge, qrChargeLoaded } = store;
  return (
    <div className="scr screen col pb-24 charge">
      <ScreenHeader title={t('charge.title')} desc={qrCharge ? undefined : t('charge.desc')} onBack={store.goBack} />
      {!qrChargeLoaded ? (
        <div className="charge-state center" aria-busy="true">
          <Spinner tone="text" />
        </div>
      ) : qrCharge ? (
        <ChargeShown key={qrCharge.request.id} store={store} charge={qrCharge} />
      ) : (
        <>
          <ChargeForm key={store.chainNet} store={store} />
          {/* Beside the form, never in it: its activation sheet holds a form of its own. */}
          <TransferAccountCard key={`transfer-${store.chainNet}`} store={store} />
        </>
      )}
    </div>
  );
}

/* --------------------------------- the form --------------------------------- */

function ChargeForm({ store }: { store: WalletStore }) {
  const t = store.t;
  const env = store.chainNet;
  const lang = store.lang;
  const { ensureChainAddresses, addressOn, rampMarket, rampTokens, createQrCharge } = store;
  const hasAccount = !store.publicAccess;
  const [draft, setDraft] = useKeptState<ChargeDraft>(`${KEPT_INPUT.chargeDraft}.${env}`, EMPTY_DRAFT);
  const patch = (p: Partial<ChargeDraft>) => setDraft((d) => ({ ...d, ...p }));

  // undefined while it loads; an error when it could not be read ('account' when only an account may).
  const [market, setMarket] = useState<RampMarket | undefined>(undefined);
  const [marketError, setMarketError] = useState<null | 'account' | 'failed'>(null);
  const [attempt, setAttempt] = useState(0);
  const [picker, setPicker] = useState<null | 'currency' | 'token'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  useEffect(() => {
    let alive = true;
    setMarket(undefined);
    setMarketError(null);
    rampMarket(BUY)
      .then((m) => alive && setMarket(m))
      .catch((e) => {
        if (!alive) return;
        const refused = e instanceof ApiRequestError && (e.status === 401 || e.status === 403);
        setMarketError(refused && !hasAccount ? 'account' : 'failed');
      });
    return () => {
      alive = false;
    };
  }, [rampMarket, attempt, hasAccount]);

  const networks: RampSheetNetwork[] = useMemo(() => {
    if (!market) return [];
    return rampNetworks(market, env, (id) => !!addressOn(id)).flatMap((n) => {
      const id = rampWalletNetwork(n.chainId, env);
      return id ? [{ chainId: n.chainId, id, name: store.networkName(id), tokenCount: n.tokenCount }] : [];
    });
  }, [market, env, addressOn, store.networkName]);

  // The ramp's defaults (`rampDefaultCurrency`, `rampTokenStart`, `rampTokenPick`): pesos when
  // they trade; the token kept from before when its network is still offered, else the market's
  // own, else the first stablecoin of the first network — read from the list so it has a price.
  const loadTokens = useCallback((s: RampSide, chainId: number, q: string, skip: number) => rampTokens(s, chainId, q, skip), [rampTokens]);
  useEffect(() => {
    if (!market) return;
    const ids = market.currencies.map((c) => c.id);
    if (!ids.includes(draft.currency)) patch({ currency: rampDefaultCurrency(ids) });
    if (draft.token && networks.some((n) => n.chainId === draft.token?.chainId)) return;
    let alive = true;
    const start = rampTokenStart(market, networks.map((n) => n.chainId));
    if (!start) {
      patch({ token: null });
      return;
    }
    loadTokens(BUY, start.chainId, start.token?.address ?? '', 0)
      .then((page) => alive && patch({ token: rampTokenPick(page.data, start.token) }))
      .catch(() => alive && start.token && patch({ token: start.token }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, networks]);

  const { money, units } = formatters(lang);
  const currencies = market?.currencies ?? [];
  const cur: RampCurrency | null = currencies.find((c) => c.id === draft.currency) ?? null;
  const token = draft.token && networks.some((n) => n.chainId === draft.token?.chainId) ? draft.token : null;
  const net = token ? rampWalletNetwork(token.chainId, env) : null;
  const netName = net ? store.networkName(net) : '';
  const address = net ? addressOn(net) : null;
  const amount = draft.amount;
  const nameOf = useCallback((c: RampCurrency) => currencyLabel(c.id, lang, c.name), [lang]);

  const problem = cur ? chargeAmountProblem(amount, cur) : 'empty';
  const min = cur ? Number(cur.minAmount) : NaN;
  const minText = cur && Number.isFinite(min) && min > 0 ? `${money(min)} ${cur.id}` : '';
  const estimate = cur && token && problem === null ? rampEstimate(BUY, amount, cur, token) : null;
  const outText = estimate !== null ? `≈ ${units(estimate)}` : '';

  // The button: what is missing, or the action.
  const cta = ((): { label: string; ok: boolean } => {
    if (!cur || !token) return { label: t('charge.ctaNone'), ok: false };
    if (!amount.trim() || problem === 'empty') return { label: t('ramp.ctaAmount'), ok: false };
    if (problem === 'format' || problem === 'decimals') return { label: t('ramp.ctaAmountBad'), ok: false };
    if (problem === 'below-min') return { label: t('ramp.ctaMin', { min: minText }), ok: false };
    if (!address) return { label: t('ramp.ctaNoAddress', { network: netName }), ok: false };
    return { label: t('charge.cta'), ok: true };
  })();

  const create = async () => {
    if (!cta.ok || !cur || !token || !address || busy) return;
    setBusy(true);
    setError('');
    try {
      await createQrCharge(
        { currency: cur.id, amount: amount.trim(), chainId: token.chainId, token: token.address, address, description: chargeDescription(draft.description) },
        token.decimals,
      );
      patch({ amount: '', description: '' });
    } catch (e) {
      const status = e instanceof ApiRequestError ? e.status : 0;
      // The shared key refused: this deployment opens charges to accounts only. A 404 is a
      // server that does not have the route yet.
      if (!hasAccount && (status === 401 || status === 403)) setError(t('charge.needAccount'));
      else if (status === 404) setError(t('charge.unavailable'));
      else setError((e as Error).message || t('charge.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------- states ------------------------------- */

  if (marketError === 'account') {
    return (
      <div className="charge-state col g12">
        <Notice>{store.meta?.email ? t('charge.needAccount') : `${t('charge.needAccount')} ${t('cosmospay.needEmail')}`}</Notice>
        {store.meta?.email && <EnableReceivingCard store={store} />}
      </div>
    );
  }
  if (marketError === 'failed') {
    return (
      <div className="charge-state col g12">
        <Notice tone="danger">{t('ramp.loadFailed')}</Notice>
        <GhostButton onClick={() => setAttempt((a) => a + 1)}>{t('ramp.retry')}</GhostButton>
      </div>
    );
  }
  if (!market) {
    return (
      <div className="charge-state center" aria-busy="true">
        <Spinner tone="text" />
      </div>
    );
  }
  if (currencies.length === 0 || networks.length === 0) {
    return <Notice className="charge-state">{t(currencies.length === 0 ? 'ramp.noMarket' : 'ramp.noNetworks')}</Notice>;
  }

  /* -------------------------------- form -------------------------------- */

  const badAmount = !!amount.trim() && problem !== null && problem !== 'empty';

  return (
    <form
      className="col charge-form"
      aria-label={t('charge.title')}
      onSubmit={(event) => {
        event.preventDefault();
        if (picker === null) void create();
      }}
    >
      <div className="swapw-panels">
        <section className={cx('swapw-panel', badAmount && 'has-error')} aria-labelledby="charge-amount-label">
          <div className="swapw-panel-top">
            <label id="charge-amount-label" htmlFor="charge-amount">
              {t('charge.amountLabel')}
            </label>
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
          </div>
          <div className="swapw-panel-row">
            <input
              id="charge-amount"
              value={amount}
              onChange={(e) => {
                const v = sanitizeDecimalInput(e.currentTarget.value, RAMP_FIAT_DECIMALS, RAMP_FIAT_MAX_DIGITS);
                if (v !== null) patch({ amount: v });
              }}
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              aria-invalid={badAmount || undefined}
              aria-describedby={minText ? 'charge-min' : undefined}
              className={cx('swapw-amount', badAmount && 'is-invalid')}
            />
          </div>
          {minText && (
            <div className="swapw-panel-foot is-plain">
              <span id="charge-min">{t('ramp.min', { min: minText })}</span>
            </div>
          )}
        </section>

        <span className="charge-seam" aria-hidden="true">
          <ArrowDownIcon />
        </span>

        <section className="swapw-panel is-get" aria-labelledby="charge-get">
          <div className="swapw-panel-top">
            <span id="charge-get">{t('ramp.receiveAbout')}</span>
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
          </div>
          <div className="swapw-panel-row">
            <output aria-labelledby="charge-get" aria-live="polite" className={cx('swapw-amount is-out', !outText && 'is-empty', !!outText && 'is-estimate')}>
              {outText || '0'}
            </output>
          </div>
          {net && (
            <div className="swapw-panel-foot is-plain">
              <span>
                {t('ramp.arrivesOn', { network: netName })}
                {address ? ` · ${shortAddr(address, 6, 4)}` : ` · ${t('ramp.addressPending')}`}
              </span>
            </div>
          )}
        </section>
      </div>

      <Field
        label={t('charge.description')}
        value={draft.description}
        onChange={(v) => patch({ description: sanitizeChargeDescription(v) })}
        placeholder={t('charge.descriptionPlaceholder')}
        tone="soft"
        className="charge-desc"
      />

      <Notice className="charge-note">{t('charge.note', { hours: CHARGE_EXPIRES_MINUTES / 60 })}</Notice>
      {env === 'testnet' && <Notice className="charge-note">{t('ramp.testNote')}</Notice>}

      <div className="charge-foot kb-dock">
        <span className="sr-only" role="status">
          {cta.label}
        </span>
        <PrimaryButton type="submit" disabled={!cta.ok || busy}>
          {busy ? <Spinner /> : cta.label}
        </PrimaryButton>
        {error && (
          <p className="swapw-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <CurrencySheet
        open={picker === 'currency'}
        title={t('charge.pickCurrency')}
        currencies={currencies}
        selected={cur?.id ?? ''}
        nameOf={nameOf}
        asideOf={(c) => {
          const r = token ? marketRate(c, token) : null;
          return r && token ? `1 ${token.symbol} = ${new Intl.NumberFormat(lang, { maximumFractionDigits: r >= 100 ? 2 : 4 }).format(r)} ${c.id}` : null;
        }}
        onPick={(id) => {
          setPicker(null);
          patch({ currency: id });
        }}
        onClose={() => setPicker(null)}
        desktop={isDesktopLayout()}
        labels={{ close: t('a11y.close'), search: t('ramp.searchCurrency'), clear: t('common.clearSearch'), none: t('ramp.noMatch') }}
      />
      <TokenSheet
        open={picker === 'token'}
        title={t('charge.pickToken')}
        side={BUY}
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
          tokens: (n) => t('ramp.tokenCount', { n: new Intl.NumberFormat(lang).format(n) }),
          failed: t('ramp.tokensFailed'),
          retry: t('ramp.retry'),
          more: t('ramp.more'),
        }}
      />
    </form>
  );
}

/* ------------------------------ the QR on screen ------------------------------ */

function ChargeShown({ store, charge }: { store: WalletStore; charge: QrCharge }) {
  const t = store.t;
  const { refreshQrCharge, watchQrChargeBalance, cancelQrCharge, clearQrCharge } = store;
  const { money, units } = formatters(store.lang);
  const visible = usePageVisible();
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopied();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const req = charge.request;
  const status = chargeStatus(charge, now);
  const watched = chargeWatched(charge, now);
  const net = rampWalletNetwork(req.chainId, store.chainNet);
  const netName = net ? store.networkName(net) : String(req.chainId);
  const urlOk = chargeUrlOk(req.url, req.id);
  const fiat = `${money(Number(req.amount))} ${req.currency}`;
  const estimate = req.estimatedAmountOut === null ? null : Number(req.estimatedAmountOut);

  // The clock: the countdown while open, and the late watch after it closes.
  useEffect(() => {
    if (!watched) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [watched]);

  // Two signals, both only while the page is in view: the API's answer every few seconds, and
  // this wallet's own balance of the token (the first read is the baseline).
  useEffect(() => {
    if (!watched || !visible) return;
    void refreshQrCharge();
    const id = setInterval(() => void refreshQrCharge(), CHARGE_POLL_MS);
    return () => clearInterval(id);
  }, [watched, visible, refreshQrCharge]);
  useEffect(() => {
    if (!watched || !visible) return;
    void watchQrChargeBalance();
    const id = setInterval(() => void watchQrChargeBalance(), CHARGE_BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [watched, visible, watchQrChargeBalance]);

  // The wallet draws the code of the page it checked (`chargeUrlOk`), not the API's picture of one.
  useEffect(() => {
    let live = true;
    setQr('');
    if (!urlOk) return;
    qrDataUrl(req.url, 'M')
      .then((value) => live && setQr(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [req.url, urlOk]);

  const share = async () => {
    // The share sheet on a phone, Web Share in a browser that has it, the clipboard when neither.
    if (!(await shareText(req.url, t('charge.shareTitle', { amount: fiat })))) void copy(req.url);
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelQrCharge();
      setAsking(false);
    } catch (e) {
      setError((e as Error).message || t('charge.cancelFailed'));
    } finally {
      setBusy(false);
    }
  };

  const newCharge = (
    <PrimaryButton onClick={clearQrCharge} className="charge-new">
      {t('charge.new')}
    </PrimaryButton>
  );
  const forLine = [t('charge.paidFor', { amount: fiat }), req.description].filter(Boolean).join(' · ');
  const getsLine =
    estimate !== null && Number.isFinite(estimate)
      ? t('charge.getsAbout', { amount: units(estimate), token: req.token, network: netName })
      : t('charge.getsOn', { token: req.token, network: netName });
  const methodsKey = chargeMethodsKey(req.methods);

  if (status === 'paid') {
    const got = charge.paid?.amount ?? null;
    const viaKey = chargePaidMethodKey(chargePaidVia(charge, now));
    return (
      <div className="charge-result is-paid" role="status">
        <span className="charge-result-mark" aria-hidden="true">
          <CheckIcon />
        </span>
        <h2 className="charge-result-title">{t('charge.paidTitle')}</h2>
        {got !== null && (
          <p className="charge-result-amount">
            +{units(Number(got))} {req.token}
          </p>
        )}
        {viaKey && <p className="charge-result-line">{t(viaKey)}</p>}
        <p className="charge-result-line">{t('charge.paidOn', { network: netName })}</p>
        <p className="charge-result-line">{forLine}</p>
        <div className="charge-result-actions">
          {newCharge}
          <GhostButton onClick={store.goBack}>{t('common.done')}</GhostButton>
        </div>
      </div>
    );
  }

  // The API received a bank transfer and is sending the token: nothing left to pay or cancel,
  // and still watched (`chargeWatched`) until the API or the balance says it arrived.
  if (status === 'processing') {
    return (
      <div className="charge-result is-processing">
        <span className="charge-result-mark is-pending" aria-hidden="true" />
        <h2 className="charge-result-title">{t('charge.processingTitle')}</h2>
        <p className="charge-result-line is-strong" role="status">
          {t('charge.processingBody')}
        </p>
        <p className="charge-result-line">{getsLine}</p>
        <p className="charge-result-line">{forLine}</p>
        <Notice className="charge-note">{t('charge.processingHint')}</Notice>
        <div className="charge-result-actions">
          <GhostButton onClick={clearQrCharge}>{t('charge.new')}</GhostButton>
        </div>
      </div>
    );
  }

  if (status === 'expired' || status === 'cancelled') {
    return (
      <div className="charge-result" role="status">
        <h2 className="charge-result-title">{t(status === 'expired' ? 'charge.expiredTitle' : 'charge.cancelledTitle')}</h2>
        <p className="charge-result-line">{forLine}</p>
        {/* Still watched for a while (`chargeWatched`): a payment already under way turns this into "received". */}
        <Notice className="charge-note">{t(status === 'expired' ? 'charge.expiredBody' : 'charge.cancelledBody')}</Notice>
        <div className="charge-result-actions">{newCharge}</div>
      </div>
    );
  }

  return (
    <div className="charge-body">
      <div className="charge-qr-col">
        <p className="charge-scan">{t('charge.scan')}</p>
        <div className="charge-qr">
          {qr ? <img src={qr} width="264" height="264" alt={t('charge.qrAlt', { amount: fiat })} className="charge-qr-img" /> : <Spinner tone="text" />}
        </div>
      </div>

      <div className="charge-details">
        <div className="charge-figures">
          <p className="charge-fiat">{fiat}</p>
          <p className="charge-gets">{getsLine}</p>
          {req.description && <p className="charge-what">{req.description}</p>}
          {methodsKey && <p className="charge-methods">{t(methodsKey)}</p>}
        </div>

        <p className="charge-expiry">{t('charge.expiresIn', { time: formatCountdown(chargeTimeLeft(charge, now)) })}</p>
        <div className="charge-waiting" role="status">
          <p className="charge-wait">
            <Spinner size={16} tone="text" />
            <span>{t('charge.waiting')}</span>
          </p>
          <p className="charge-hint">{t('charge.waitingHint')}</p>
        </div>

        <div className="charge-actions">
          <PrimaryButton onClick={() => void share()} disabled={!urlOk}>
            {copied ? t('common.copied') : t('charge.share')}
          </PrimaryButton>
          <GhostButton onClick={clearQrCharge}>{t('charge.new')}</GhostButton>
        </div>

        {asking ? (
          <Notice tone="danger" className="charge-confirm">
            <span>{t('charge.cancelAsk')}</span>
            <span className="charge-confirm-actions">
              <GhostButton onClick={() => setAsking(false)} disabled={busy}>
                {t('charge.keep')}
              </GhostButton>
              <button type="button" onClick={() => void cancel()} disabled={busy} className="charge-danger-btn">
                {busy ? <Spinner size={16} tone="text" /> : t('charge.cancelYes')}
              </button>
            </span>
          </Notice>
        ) : (
          chargeCancellable(charge, now) && (
            <button type="button" className="link-btn charge-cancel" onClick={() => setAsking(true)}>
              {t('charge.cancel')}
            </button>
          )
        )}
        {error && (
          <p className="swapw-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
