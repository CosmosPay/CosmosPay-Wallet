import { useId, useMemo, useRef, useState } from 'react';
import { AssetLogo } from '@/ui/AssetLogo';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { CheckIcon, ChevronDownIcon, CloseIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { isDesktopLayout } from '@/lib/layout';
import type { TFn } from '@/lib/i18n';
import { NETWORKS, NETWORK_GROUPS, type NetworkId } from '@/constants/networks';
import '@/styles/features/money/network-picker.css';

/**
 * Which network: the trigger names the chosen one, and opens every network the wallet holds an
 * address on — a sheet from the bottom on a phone, a panel under the trigger on a desktop window
 * (`isDesktopLayout`, read at the tap). Thirty-odd networks do not fit a row of tabs, so the list
 * has a search and is grouped by the address the networks share (the EVM ones, Solana and Fogo,
 * Aptos and Movement), which is also what tells a person that one address serves them all.
 */
export function NetworkPicker({
  value,
  onPick,
  networks,
  t,
}: {
  value: NetworkId;
  onPick: (net: NetworkId) => void;
  /** The networks offered, in any order; the list keeps the registry's grouping. */
  networks: readonly NetworkId[];
  t: TFn;
}) {
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => {
    setOpen(null);
    setQuery('');
  };
  const current = NETWORKS[value];

  const groups = useMemo(() => {
    const offered = new Set(networks);
    const q = query.trim().toLowerCase();
    const match = (id: NetworkId) => !q || NETWORKS[id].name.toLowerCase().includes(q) || NETWORKS[id].coin.toLowerCase().includes(q);
    return NETWORK_GROUPS.map((g) => ({ kind: g.kind, ids: g.networks.filter((id) => offered.has(id) && match(id)) })).filter((g) => g.ids.length > 0);
  }, [networks, query]);

  const list = (
    <div className="network-picker-body">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
        placeholder={t('networks.search')}
        aria-label={t('networks.search')}
        className="input network-picker-search"
        data-autofocus
      />
      <div role="listbox" aria-label={t('receive.network')} className="network-picker-list">
        {groups.map((g) => (
          <div key={g.kind} role="group" aria-label={g.ids.length > 1 ? t('networks.sameAddress') : undefined} className="network-picker-group">
            {g.ids.length > 1 && <div className="network-picker-group-head">{t('networks.sameAddress')}</div>}
            {g.ids.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === value}
                onClick={() => {
                  onPick(id);
                  close();
                }}
                className={cx('network-picker-item', id === value && 'is-on')}
              >
                <AssetLogo code={NETWORKS[id].coin} size={26} />
                <span className="network-picker-name">{NETWORKS[id].name}</span>
                <span className="network-picker-coin">{NETWORKS[id].coin}</span>
                {id === value && <CheckIcon className="network-picker-check" />}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="network-picker-none">{t('networks.noMatch')}</p>}
      </div>
    </div>
  );

  return (
    <div className="network-picker">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={t('networks.pick', { network: current.name })}
        onClick={() => setOpen((o) => (o ? null : isDesktopLayout() ? 'menu' : 'sheet'))}
        className="network-picker-btn ink"
        {...inkHandlers}
      >
        <AssetLogo code={current.coin} size={26} />
        <span className="network-picker-current">{current.name}</span>
        <ChevronDownIcon className={cx('network-picker-caret', open && 'is-open')} />
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('receive.network')} className="network-picker-menu">
        {list}
      </Dropdown>
      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('receive.network')}
          </h2>
          <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={close} {...inkHandlers}>
            <CloseIcon />
          </button>
        </div>
        {list}
      </Sheet>
    </div>
  );
}
