import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NetworkId } from '@/constants/networks';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { isDesktopLayout } from '@/lib/layout';
import { foldText } from '@/lib/assetList';
import { NetworkLogo } from '@/ui/AssetLogo';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
import { CheckIcon, ChevronDownIcon, CloseIcon, CosmosMark } from '@/ui/Icons';
import '@/styles/ui/network-select.css';

export interface NetworkOption {
  id: NetworkId;
  /** The name shown (and searched). */
  name: string;
  /** The line under it: what is there. */
  sub: string;
  /** A figure at the row's end, when there is one. */
  value?: string;
  /** Which section it goes under; `quiet` rows are the ones with nothing there. */
  section: 'top' | 'rest';
}

/**
 * A network selector the way multi-network wallets draw one: a button naming the choice — "all
 * networks" wears the Cosmos Wallet mark, a network its own — and a panel with a search, "all
 * networks" first, then the networks in two sections. Under the button on a PC window, a sheet
 * on a phone; the search takes the focus on a PC window only (on a phone the keyboard would
 * cover the list). Used by Home's assets and by "add an asset".
 */
export function NetworkSelect({
  value,
  onChange,
  options,
  all,
  labels,
}: {
  value: 'all' | NetworkId;
  onChange: (value: 'all' | NetworkId) => void;
  options: readonly NetworkOption[];
  all: { name: string; sub: string; value?: string };
  labels: { title: string; search: string; noMatch: string; close: string; clear: string; top: string; rest: string; button: string };
}) {
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => {
    setOpen(null);
    setQuery('');
  };
  const pick = (v: 'all' | NetworkId) => {
    onChange(v);
    close();
  };

  const shown = useMemo(() => {
    const q = foldText(query);
    return q ? options.filter((o) => foldText(`${o.name} ${o.id}`).includes(q)) : options;
  }, [options, query]);
  const top = shown.filter((o) => o.section === 'top');
  const rest = shown.filter((o) => o.section === 'rest');
  const current = value === 'all' ? null : options.find((o) => o.id === value) ?? null;

  const item = (key: string, on: boolean, mark: ReactNode, name: string, sub: string, figure: string | undefined, quiet: boolean, onPick: () => void) => (
    <button key={key} type="button" role="radio" aria-checked={on} onClick={onPick} className={cx('net-select-item', on && 'is-on', quiet && 'is-quiet')}>
      {mark}
      <span className="net-select-text">
        <span className="net-select-name">{name}</span>
        <span className="net-select-sub">{sub}</span>
      </span>
      {figure !== undefined && <span className="net-select-value">{figure}</span>}
      <span className="net-select-check" aria-hidden="true">
        {on && <CheckIcon />}
      </span>
    </button>
  );

  const list = (desktop: boolean) => (
    <div className="net-select-body">
      <SearchField value={query} onChange={setQuery} placeholder={labels.search} label={labels.search} clearLabel={labels.clear} autoFocus={desktop} compact />
      <div role="radiogroup" aria-label={labels.title} className="net-select-list">
        {!query && item('all', value === 'all', <AllNetworksMark size="row" />, all.name, all.sub, all.value, false, () => pick('all'))}
        {top.length > 0 && labels.top && <div className="net-select-head">{labels.top}</div>}
        {top.map((o) => item(o.id, value === o.id, <NetworkLogo network={o.id} size={28} />, o.name, o.sub, o.value, false, () => pick(o.id)))}
        {rest.length > 0 && labels.rest && <div className="net-select-head">{labels.rest}</div>}
        {rest.map((o) => item(o.id, value === o.id, <NetworkLogo network={o.id} size={28} />, o.name, o.sub, o.value, true, () => pick(o.id)))}
        {shown.length === 0 && <p className="net-select-none">{labels.noMatch}</p>}
      </div>
    </div>
  );

  return (
    <div className="net-select">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={labels.button}
        onClick={() => (open ? close() : setOpen(isDesktopLayout() ? 'menu' : 'sheet'))}
        className="net-select-btn"
      >
        {current ? <NetworkLogo network={current.id} size={20} /> : <AllNetworksMark size="button" />}
        <span className="net-select-btn-label">{current ? current.name : all.name}</span>
        <ChevronDownIcon className={cx('net-select-caret', open && 'is-open')} />
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={labels.title} className="net-select-panel">
        <p className="net-select-title">{labels.title}</p>
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

/** "All networks": the Cosmos Wallet mark in a ring — the wallet's own, not one network's. */
export function AllNetworksMark({ size }: { size: 'button' | 'row' }) {
  return (
    <span className={cx('net-all-mark', `is-${size}`)} aria-hidden="true">
      <CosmosMark />
    </span>
  );
}
