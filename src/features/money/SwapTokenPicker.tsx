import { useId, useMemo, useState } from 'react';
import type { NetworkId } from '@/constants/networks';
import type { SwapToken } from '@/lib/swapCatalog';
import { tokenMatches } from '@/lib/swapCatalog';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { isHomeCoin } from '@/lib/logos';
import { AssetLogo, NetworkLogo } from '@/ui/AssetLogo';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { CheckIcon, CloseIcon } from '@/ui/Icons';
import '@/styles/features/money/swap.css';

/** Rows shown at once: a search narrows the rest (two hundred tokens scroll badly on a phone). */
const MAX_ROWS = 250;

/**
 * The swap form's "select a token" sheet (the developer platform's TokenPicker): every token the
 * side can take, on every network, with a search over symbol, network, issuer and address; the
 * ones the wallet holds first, with what it holds, then the rest. A sheet from the bottom on a
 * phone; on a PC window a dialog in the middle, like the platform's — the list is long, a panel
 * under a button would not hold it.
 */
export function SwapTokenPicker({
  open,
  title,
  tokens,
  selectedKey,
  heldOf,
  networkName,
  onPick,
  onClose,
  labels,
  desktop,
}: {
  open: boolean;
  title: string;
  tokens: readonly SwapToken[];
  selectedKey: string | null;
  heldOf: (t: SwapToken) => string | null;
  networkName: (id: NetworkId) => string;
  onPick: (t: SwapToken) => void;
  onClose: () => void;
  labels: { search: string; clear: string; close: string; held: string; all: string; none: string };
  desktop: boolean;
}) {
  const [query, setQuery] = useState('');
  const titleId = useId();
  const close = () => {
    setQuery('');
    onClose();
  };
  const shown = useMemo(() => tokens.filter((t) => tokenMatches(t, query, networkName)), [tokens, query, networkName]);
  const held = shown.filter((t) => heldOf(t) !== null);
  const rest = shown.filter((t) => heldOf(t) === null).slice(0, MAX_ROWS);

  const row = (t: SwapToken) => {
    const on = t.key === selectedKey;
    const amount = heldOf(t);
    return (
      <button
        key={t.key}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => {
          setQuery('');
          onPick(t);
        }}
        className={cx('swapw-pick-item', on && 'is-on')}
      >
        <TokenMark token={t} size="row" />
        <span className="swapw-pick-text">
          <span className="swapw-pick-sym">{t.symbol}</span>
          <span className="swapw-pick-sub">
            {networkName(t.chain)}
            {t.issuerName ? ` · ${t.issuerName}` : ''}
          </span>
        </span>
        {amount !== null && <span className="swapw-pick-bal">{amount}</span>}
        <span className="swapw-pick-check" aria-hidden="true">
          {on && <CheckIcon />}
        </span>
      </button>
    );
  };

  return (
    <Sheet open={open} onClose={close} labelledBy={titleId} placement={desktop ? 'center' : 'bottom'}>
      <div className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        <button type="button" className="sheet-close ink" aria-label={labels.close} onClick={close} {...inkHandlers}>
          <CloseIcon />
        </button>
      </div>
      <div className="swapw-pick-body">
        <SearchField value={query} onChange={setQuery} placeholder={labels.search} label={labels.search} clearLabel={labels.clear} autoFocus={desktop} compact />
        <div role="radiogroup" aria-label={title} className="swapw-pick-list">
          {held.length > 0 && <div className="swapw-pick-head">{labels.held}</div>}
          {held.map(row)}
          {rest.length > 0 && <div className="swapw-pick-head">{labels.all}</div>}
          {rest.map(row)}
          {shown.length === 0 && <p className="swapw-pick-none">{labels.none}</p>}
        </div>
      </div>
    </Sheet>
  );
}

/** A token's mark: its logo, with its network's on the corner unless it is that network's coin. */
export function TokenMark({ token, size }: { token: SwapToken; size: 'button' | 'row' }) {
  return (
    <span className={cx('swapw-mark', `is-${size}`)}>
      <AssetLogo code={token.symbol} size={size === 'button' ? 28 : 36} />
      {!isHomeCoin(token.chain, token.symbol) && (
        <span className="swapw-mark-net" aria-hidden="true">
          <NetworkLogo network={token.chain} size={20} />
        </span>
      )}
    </span>
  );
}
