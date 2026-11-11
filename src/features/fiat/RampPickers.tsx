import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import type { NetworkId } from '@/constants/networks';
import { RAMP_NATIVE_TOKEN, RAMP_SEARCH_DEBOUNCE_MS, type RampSide } from '@/constants/ramp';
import { cx } from '@/lib/cx';
import { foldText } from '@/lib/assetList';
import { isHomeCoin } from '@/lib/logos';
import { shortAddr } from '@/lib/format';
import { currencyCountry, type RampCurrency, type RampToken, type RampTokenPage } from '@/lib/p2pRamp';
import { AssetLogo, NetworkLogo } from '@/ui/AssetLogo';
import { TokenAvatar } from '@/ui/TokenAvatar';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { Spinner } from '@/ui/Spinner';
import { CheckIcon, ChevronDownIcon, CloseIcon } from '@/ui/Icons';
import '@/styles/ui/swap-widget.css';
import '@/styles/features/fiat/ramp-pickers.css';

const CurrencyFlagArt = lazy(() => import('@/features/fiat/currencyFlags'));

/** A local currency's mark: its country's flag, round; its two letters while it loads or without one. */
export function CurrencyFlag({ id, size }: { id: string; size: 'button' | 'row' }) {
  const mono = <span className="ramp-flag-mono">{currencyCountry(id)}</span>;
  return (
    <span className={cx('ramp-flag', `is-${size}`)} aria-hidden="true">
      <Suspense fallback={mono}>
        <CurrencyFlagArt country={currencyCountry(id)} fallback={mono} />
      </Suspense>
    </span>
  );
}

/**
 * A token's mark with its network's on the corner. Only a network's main asset (matched by
 * address on the API) wears the official artwork: the marketplace's lists carry copies of
 * known symbols on other contracts, and those keep a plain monogram.
 */
export function RampTokenMark({ token, network, size }: { token: RampToken; network: NetworkId; size: 'button' | 'row' }) {
  const px = size === 'button' ? 28 : 36;
  return (
    <span className={cx('swapw-mark', `is-${size}`)}>
      {token.main === false ? <TokenAvatar glyph={token.symbol.slice(0, 1) || '?'} tone="base" size={px} /> : <AssetLogo code={token.symbol} size={px} />}
      {!isHomeCoin(network, token.symbol) && (
        <span className="swapw-mark-net" aria-hidden="true">
          <NetworkLogo network={network} size={20} />
        </span>
      )}
    </span>
  );
}

interface SheetLabels {
  close: string;
  search: string;
  clear: string;
  none: string;
}

/** The currency sheet: each currency with its flag, its name in the reader's language and its rate. */
export function CurrencySheet({
  open,
  title,
  currencies,
  selected,
  nameOf,
  asideOf,
  onPick,
  onClose,
  desktop,
  labels,
}: {
  open: boolean;
  title: string;
  currencies: readonly RampCurrency[];
  selected: string;
  nameOf: (c: RampCurrency) => string;
  asideOf: (c: RampCurrency) => string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  desktop: boolean;
  labels: SheetLabels;
}) {
  const [query, setQuery] = useState('');
  const titleId = useId();
  const close = () => {
    setQuery('');
    onClose();
  };
  const shown = useMemo(() => {
    const q = foldText(query);
    if (!q) return currencies;
    return currencies.filter((c) => foldText([c.id, c.name, nameOf(c), ...c.paymentMethods.map((m) => m.name)].join(' ')).includes(q));
  }, [currencies, query, nameOf]);

  return (
    <Sheet open={open} onClose={close} labelledBy={titleId} placement={desktop ? 'center' : 'bottom'}>
      <div className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        <button type="button" className="sheet-close ink" aria-label={labels.close} onClick={close}>
          <CloseIcon />
        </button>
      </div>
      <div className="swapw-pick-body">
        {currencies.length > 6 && (
          <SearchField value={query} onChange={setQuery} placeholder={labels.search} label={labels.search} clearLabel={labels.clear} autoFocus={desktop} compact />
        )}
        <div role="radiogroup" aria-label={title} className="swapw-pick-list">
          {shown.map((c) => {
            const on = c.id === selected;
            const aside = asideOf(c);
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setQuery('');
                  onPick(c.id);
                }}
                className={cx('swapw-pick-item', on && 'is-on')}
              >
                <CurrencyFlag id={c.id} size="row" />
                <span className="swapw-pick-text">
                  <span className="swapw-pick-sym">{c.id}</span>
                  <span className="swapw-pick-sub">{nameOf(c)}</span>
                </span>
                {aside && <span className="ramp-pick-aside">{aside}</span>}
                <span className="swapw-pick-check" aria-hidden="true">
                  {on && <CheckIcon />}
                </span>
              </button>
            );
          })}
          {shown.length === 0 && <p className="swapw-pick-none">{labels.none}</p>}
        </div>
      </div>
    </Sheet>
  );
}

export interface RampSheetNetwork {
  chainId: number;
  id: NetworkId;
  name: string;
  tokenCount: number;
}

/**
 * The token sheet: one network at a time (its button opens the list of the networks this wallet
 * can use, each with how many tokens it lists), that network's tokens from the API, main assets
 * first, searched by symbol or a pasted address. A page holds the first hundred; "more" asks for
 * the next.
 */
export function TokenSheet({
  open,
  title,
  side,
  networks,
  selected,
  load,
  onPick,
  onClose,
  desktop,
  labels,
}: {
  open: boolean;
  title: string;
  side: RampSide;
  networks: readonly RampSheetNetwork[];
  selected: RampToken | null;
  load: (side: RampSide, chainId: number, q: string, skip: number) => Promise<RampTokenPage>;
  onPick: (token: RampToken) => void;
  onClose: () => void;
  desktop: boolean;
  labels: SheetLabels & { network: string; pickNetwork: string; tokens: (n: number) => string; failed: string; retry: string; more: string };
}) {
  const titleId = useId();
  const [chainId, setChainId] = useState<number | null>(selected?.chainId ?? networks[0]?.chainId ?? null);
  const [choosingNetwork, setChoosingNetwork] = useState(false);
  const [query, setQuery] = useState('');
  // undefined while a first page loads, null when it failed.
  const [rows, setRows] = useState<RampToken[] | null | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A sheet opened again starts on the chosen token's network.
  useEffect(() => {
    if (open && selected && networks.some((n) => n.chainId === selected.chainId)) setChainId(selected.chainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (chainId === null || !networks.some((n) => n.chainId === chainId)) setChainId(networks[0]?.chainId ?? null);
  }, [networks, chainId]);

  useEffect(() => {
    if (!open || chainId === null) return;
    let alive = true;
    setRows(undefined);
    const timer = setTimeout(
      () => {
        load(side, chainId, query, 0)
          .then((page) => {
            if (!alive) return;
            setRows(page.data);
            setTotal(page.total);
          })
          .catch(() => alive && setRows(null));
      },
      query ? RAMP_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, side, chainId, query, load, attempt]);

  const more = () => {
    if (!rows || chainId === null || moreBusy) return;
    setMoreBusy(true);
    load(side, chainId, query, rows.length)
      .then((page) => {
        setRows((r) => [...(r ?? []), ...page.data]);
        setTotal(page.total);
      })
      .catch(() => {})
      .finally(() => setMoreBusy(false));
  };

  const close = () => {
    setQuery('');
    setChoosingNetwork(false);
    onClose();
  };
  const net = networks.find((n) => n.chainId === chainId) ?? null;
  const isOn = (x: RampToken) => !!selected && x.chainId === selected.chainId && x.address.toLowerCase() === selected.address.toLowerCase();

  return (
    <Sheet open={open} onClose={close} labelledBy={titleId} placement={desktop ? 'center' : 'bottom'}>
      <div className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {choosingNetwork ? labels.pickNetwork : title}
        </h2>
        <button type="button" className="sheet-close ink" aria-label={labels.close} onClick={close}>
          <CloseIcon />
        </button>
      </div>
      {choosingNetwork ? (
        <div className="swapw-pick-body">
          <div role="radiogroup" aria-label={labels.pickNetwork} className="swapw-pick-list">
            {networks.map((n) => {
              const on = n.chainId === chainId;
              return (
                <button
                  key={n.chainId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setChainId(n.chainId);
                    setQuery('');
                    setChoosingNetwork(false);
                  }}
                  className={cx('swapw-pick-item', on && 'is-on')}
                >
                  <span className="swapw-mark is-row">
                    <NetworkLogo network={n.id} size={36} />
                  </span>
                  <span className="swapw-pick-text">
                    <span className="swapw-pick-sym">{n.name}</span>
                    <span className="swapw-pick-sub">{labels.tokens(n.tokenCount)}</span>
                  </span>
                  <span className="swapw-pick-check" aria-hidden="true">
                    {on && <CheckIcon />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="swapw-pick-body">
          <div className="ramp-pick-tools">
            {net && (
              <button
                type="button"
                className="ramp-pick-net"
                onClick={() => setChoosingNetwork(true)}
                disabled={networks.length < 2}
                aria-label={`${labels.network}: ${net.name}`}
              >
                <NetworkLogo network={net.id} size={24} />
                <span>{net.name}</span>
                {networks.length > 1 && <ChevronDownIcon className="ramp-pick-net-chev" />}
              </button>
            )}
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={labels.search}
              label={labels.search}
              clearLabel={labels.clear}
              autoFocus={desktop}
              compact
              className="f1"
            />
          </div>
          <div role="radiogroup" aria-label={title} aria-busy={rows === undefined || undefined} className="swapw-pick-list">
            {rows === undefined && (
              <div className="ramp-pick-wait">
                <Spinner size={18} tone="text" />
              </div>
            )}
            {rows === null && (
              <div className="ramp-pick-failed" role="alert">
                <p className="swapw-pick-none">{labels.failed}</p>
                <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>
                  {labels.retry}
                </button>
              </div>
            )}
            {net &&
              rows?.map((x) => {
                const on = isOn(x);
                return (
                  <button
                    key={`${x.chainId}:${x.address}`}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setQuery('');
                      onPick(x);
                    }}
                    className={cx('swapw-pick-item', on && 'is-on')}
                  >
                    <RampTokenMark token={x} network={net.id} size="row" />
                    <span className="swapw-pick-text">
                      <span className="swapw-pick-sym">{x.symbol}</span>
                      <span className="swapw-pick-sub">
                        {net.name}
                        {x.address !== RAMP_NATIVE_TOKEN ? ` · ${shortAddr(x.address, 6, 4)}` : ''}
                      </span>
                    </span>
                    <span className="swapw-pick-check" aria-hidden="true">
                      {on && <CheckIcon />}
                    </span>
                  </button>
                );
              })}
            {rows && rows.length === 0 && <p className="swapw-pick-none">{labels.none}</p>}
            {rows && rows.length < total && (
              <button type="button" className="link-btn ramp-pick-more" onClick={more} disabled={moreBusy}>
                {moreBusy ? <Spinner size={16} tone="text" /> : labels.more}
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
