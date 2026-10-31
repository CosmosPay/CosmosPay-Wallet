import { useId, useMemo, useRef, useState } from 'react';
import type { NetworkId } from '@/constants/networks';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { isDesktopLayout } from '@/lib/layout';
import { isHomeCoin } from '@/lib/logos';
import { rowMatches } from '@/lib/assetList';
import { AssetLogo, NetworkLogo, assetMeta } from '@/ui/AssetLogo';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { CheckIcon, ChevronDownIcon, CloseIcon } from '@/ui/Icons';
import '@/styles/features/money/send.css';

/** One asset Send can send: on which network, its code, and what is held of it. */
export interface SendOption {
  key: string;
  network: NetworkId;
  networkName: string;
  code: string;
  /** "18,034.8011", or null while unknown. */
  balance: string | null;
  held: boolean;
}

/**
 * What to send, first — the way wallets ask it: a card naming the asset, its network and what is
 * held of it, opening every asset the wallet can send on every network it signs on, with a
 * search; the ones it holds first. Choosing an asset chooses its network. A panel under the card
 * on a PC window, a sheet on a phone (no focus on the search there: the keyboard would cover it).
 */
export function SendAssetPicker({
  options,
  value,
  onPick,
  labels,
}: {
  options: readonly SendOption[];
  value: string;
  onPick: (key: string) => void;
  labels: { title: string; search: string; clear: string; close: string; held: string; others: string; none: string; available: string };
}) {
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => {
    setOpen(null);
    setQuery('');
  };
  const current = options.find((o) => o.key === value) ?? options[0];
  const shown = useMemo(
    () => options.filter((o) => rowMatches(query, [o.code, assetMeta(o.code).name, o.networkName])),
    [options, query],
  );
  const held = shown.filter((o) => o.held);
  const others = shown.filter((o) => !o.held);

  const mark = (o: SendOption, size: 'card' | 'row') => (
    <span className={cx('send-asset-mark', `is-${size}`)}>
      <AssetLogo code={o.code} size={size === 'card' ? 44 : 36} />
      {!isHomeCoin(o.network, o.code) && (
        <span className="send-asset-net" aria-hidden="true">
          <NetworkLogo network={o.network} size={20} />
        </span>
      )}
    </span>
  );

  const row = (o: SendOption) => (
    <button
      key={o.key}
      type="button"
      role="radio"
      aria-checked={o.key === current?.key}
      onClick={() => {
        onPick(o.key);
        close();
      }}
      className={cx('send-asset-item', o.key === current?.key && 'is-on')}
    >
      {mark(o, 'row')}
      <span className="send-asset-text">
        <span className="send-asset-code">{o.code}</span>
        <span className="send-asset-sub">{o.networkName}</span>
      </span>
      <span className="send-asset-bal">{o.balance ?? '—'}</span>
      <span className="send-asset-check" aria-hidden="true">
        {o.key === current?.key && <CheckIcon />}
      </span>
    </button>
  );

  const list = (desktop: boolean) => (
    <div className="send-asset-body">
      <SearchField value={query} onChange={setQuery} placeholder={labels.search} label={labels.search} clearLabel={labels.clear} autoFocus={desktop} compact />
      <div role="radiogroup" aria-label={labels.title} className="send-asset-list">
        {held.length > 0 && <div className="send-asset-head">{labels.held}</div>}
        {held.map(row)}
        {others.length > 0 && <div className="send-asset-head">{labels.others}</div>}
        {others.map(row)}
        {shown.length === 0 && <p className="send-asset-none">{labels.none}</p>}
      </div>
    </div>
  );

  if (!current) return null;
  return (
    <div className="send-asset">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        onClick={() => (open ? close() : setOpen(isDesktopLayout() ? 'menu' : 'sheet'))}
        className="send-asset-card"
      >
        {mark(current, 'card')}
        <span className="send-asset-text">
          <span className="send-asset-code is-card">{current.code}</span>
          <span className="send-asset-sub">
            {current.networkName} · {labels.available} {current.balance ?? '—'}
          </span>
        </span>
        <ChevronDownIcon className={cx('send-asset-caret', open && 'is-open')} />
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={labels.title} className="send-asset-panel">
        <p className="send-asset-title">{labels.title}</p>
        {list(true)}
      </Dropdown>
      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {labels.title}
          </h2>
          <button type="button" className="sheet-close ink" aria-label={labels.close} onClick={close} {...inkHandlers}>
            <CloseIcon />
          </button>
        </div>
        {list(false)}
      </Sheet>
    </div>
  );
}
