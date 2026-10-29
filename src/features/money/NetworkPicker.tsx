import { useId, useMemo, useRef, useState } from 'react';
import { NetworkLogo } from '@/ui/AssetLogo';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';
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
  nameOf = (id) => NETWORKS[id].name,
  variant = 'pill',
  subOf,
  t,
}: {
  value: NetworkId;
  onPick: (net: NetworkId) => void;
  /** The networks offered, in any order; the list keeps the registry's grouping. */
  networks: readonly NetworkId[];
  /** Each network's name as the screen calls it (the store's, in the wallet's mode). */
  nameOf?: (id: NetworkId) => string;
  /** `card`: a full-width card naming the network and `subOf`'s line, like Send's asset card. */
  variant?: 'pill' | 'card';
  subOf?: (id: NetworkId) => string;
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
    const match = (id: NetworkId) => !q || nameOf(id).toLowerCase().includes(q) || NETWORKS[id].coin.toLowerCase().includes(q);
    return NETWORK_GROUPS.map((g) => ({ kind: g.kind, ids: g.networks.filter((id) => offered.has(id) && match(id)) })).filter((g) => g.ids.length > 0);
  }, [networks, query, nameOf]);

  // The search takes the focus on a PC window only: on a phone it would raise the keyboard
  // over the list it searches.
  const list = (desktop: boolean) => (
    <div className="network-picker-body">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t('networks.search')}
        label={t('networks.search')}
        clearLabel={t('common.clearSearch')}
        autoFocus={desktop}
        compact
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
                <NetworkLogo network={id} size={26} />
                <span className="network-picker-name">{nameOf(id)}</span>
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
    <div className={cx('network-picker', variant === 'card' && 'is-card')}>
      {variant === 'card' ? (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open !== null}
          aria-label={t('networks.pick', { network: nameOf(value) })}
          onClick={() => setOpen((o) => (o ? null : isDesktopLayout() ? 'menu' : 'sheet'))}
          className="network-picker-card"
        >
          <NetworkLogo network={value} size={44} />
          <span className="network-picker-card-text">
            <span className="network-picker-card-name">{nameOf(value)}</span>
            {subOf && <span className="network-picker-card-sub">{subOf(value)}</span>}
          </span>
          <ChevronDownIcon className={cx('network-picker-caret', open && 'is-open')} />
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open !== null}
          aria-label={t('networks.pick', { network: nameOf(value) })}
          onClick={() => setOpen((o) => (o ? null : isDesktopLayout() ? 'menu' : 'sheet'))}
          className="network-picker-btn ink"
          {...inkHandlers}
        >
          <NetworkLogo network={value} size={26} />
          <span className="network-picker-current">{nameOf(value)}</span>
          <ChevronDownIcon className={cx('network-picker-caret', open && 'is-open')} />
        </button>
      )}
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('receive.network')} className="network-picker-menu">
        {list(true)}
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
        {list(false)}
      </Sheet>
    </div>
  );
}
