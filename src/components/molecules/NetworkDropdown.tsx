import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { StellarMark } from '@/components/atoms/StellarMark';
import '@/styles/components/network-dropdown.css';

/** Network selector as a dropdown (lists networks + "add network") — dev fast-access.
 *  The trigger is a circular header button (same 38px form as the profile avatar);
 *  the active network shows as a tooltip and inside the open menu.
 *  `align="right"` opens the menu right-aligned (for placement in the top-right corner). */
export function NetworkDropdown({ store, align = 'left' }: { store: WalletStore; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="network-dd">
      <button onClick={() => setOpen((o) => !o)} title={store.network.label} aria-label={store.network.label} className="glass-soft circle-btn">
        <StellarMark size={16} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="network-dd-scrim" />
          <div className="glass network-dd-menu" style={align === 'right' ? { right: 0 } : { left: 0 }}>
            {store.networks.map((n) => {
              const on = n.id === store.network.id;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!on) store.switchNetwork(n.id);
                    setOpen(false);
                  }}
                  className="tap network-dd-item"
                  style={on ? { background: 'var(--surface)' } : undefined}
                >
                  <StellarMark size={14} />
                  <span className="f1 network-dd-label">{n.label}</span>
                  {on && <span className="network-dd-check">✓</span>}
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
              <span className="network-dd-plus">+</span>
              {store.t('net.add')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
