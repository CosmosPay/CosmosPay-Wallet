import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { StellarMark } from '@/features/wallet/StellarMark';
import { Icon } from '@/ui/Icon';
import { networkEnv } from '@/lib/stellar';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/network-dropdown.css';

/** Network selector as a dropdown (lists networks + "add network").
 *  The trigger is a chip naming the active network, with a dot that says at a glance
 *  whether it is real money (green) or a test network (amber).
 *  `align="right"` opens the menu right-aligned (for placement in the top-right corner). */
export function NetworkDropdown({ store, align = 'left' }: { store: WalletStore; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="network-dd">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={store.network.label}
        aria-label={store.network.label}
        aria-expanded={open}
        className={cx('chip network-dd-trigger', open && 'is-open')}
      >
        <span className={cx('network-dd-dot', networkEnv(store.network) === 'dev' && 'is-test')} />
        <span className="network-dd-name">{store.network.label}</span>
        <Icon name="chevron-down" size={14} className="network-dd-chev" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="network-dd-scrim" />
          <div className={`glass network-dd-menu is-${align}`}>
            {store.networks.map((n) => {
              const on = n.id === store.network.id;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!on) store.switchNetwork(n.id);
                    setOpen(false);
                  }}
                  className={cx('tap network-dd-item', on && 'is-on')}
                >
                  <StellarMark size={14} />
                  <span className="f1 network-dd-label">{n.label}</span>
                  {on && <Icon name="check" size={16} className="network-dd-check" />}
                </div>
              );
            })}
            <div
              onClick={() => {
                setOpen(false);
                store.setScreen('add-network');
              }}
              className="tap network-dd-add"
            >
              <Icon name="plus" size={16} className="network-dd-plus" />
              {store.t('net.add')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
