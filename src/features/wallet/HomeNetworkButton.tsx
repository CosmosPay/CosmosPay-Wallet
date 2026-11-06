import { useId, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { CheckIcon, ChevronDownIcon, CloseIcon, GlobeIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import { isDesktopLayout } from '@/lib/layout';
import '@/styles/features/wallet/home-header.css';

/**
 * The active Stellar network beside the balance label: a quiet text selector with a network
 * glyph and a disclosure arrow. A panel opens under it on desktop, a sheet from the bottom
 * on a phone, like the network picker. The same
 * list as the Wallet tab's, ending in the way to add one.
 */
export function HomeNetworkButton({ store }: { store: WalletStore }) {
  const t = store.t;
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const close = () => setOpen(null);
  const pick = (id: string) => {
    close();
    if (id !== store.network.id) void store.switchNetwork(id);
  };

  const list = (
    <div className="home-menu-body">
      <div role="radiogroup" aria-label={t('wallets.ledger')} className="home-menu-list">
        {store.networks.map((n) => {
          const on = n.id === store.network.id;
          return (
            <button
              key={n.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(n.id)}
              className={cx('home-menu-item', on && 'is-on')}
            >
              <span className="home-menu-item-text">{n.label}</span>
              {on && <CheckIcon className="home-menu-check" />}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="link-btn home-menu-link"
        onClick={() => {
          close();
          store.setScreen('add-network');
        }}
      >
        {t('wallets.addNetwork')}
      </button>
    </div>
  );

  return (
    <div className="home-menu home-network-menu">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={t('home.networkPick', { network: store.network.label })}
        title={t('home.networkPick', { network: store.network.label })}
        onClick={() => setOpen((o) => (o ? null : isDesktopLayout() ? 'menu' : 'sheet'))}
        className={cx('home-net-trigger', open !== null && 'is-open')}
      >
        <GlobeIcon className="home-net-icon" />
        <span className="home-net-label">{store.network.label}</span>
        <ChevronDownIcon className={cx('home-net-caret', open && 'is-open')} />
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('wallets.ledger')} className="home-menu-panel">
        <p className="home-menu-title">{t('wallets.ledger')}</p>
        {list}
      </Dropdown>
      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('wallets.ledger')}
          </h2>
          <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={close}>
            <CloseIcon />
          </button>
        </div>
        {list}
      </Sheet>
    </div>
  );
}
