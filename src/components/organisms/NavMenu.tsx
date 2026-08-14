import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { Logo } from '@/components/atoms/Logo';
import { navTabs, navActiveKey, navGo } from './nav';
import { cx } from '@/lib/cx';
import '@/styles/components/nav-menu.css';

/** Both drawer sections share ONE row style (metrics, weight, trailing ›). The
 *  active tab is distinguished by its highlighted background only. */
function NavItem({ lead, label, on, onClick }: { lead: ReactNode; label: string; on?: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} className={cx('tap nav-menu-item', on && 'is-on')}>
      {lead}
      <span className="f1 nav-menu-item-label">{label}</span>
      <span className="nav-menu-chevron">›</span>
    </div>
  );
}

/** Extension-mode navigation: a hamburger button that lives in each tab screen's
 *  header (next to the profile avatar on Home). Opens a FULL-VIEW drawer that slides
 *  in from the right edge and slides back out on close. Replaces the phone bottom
 *  bar, which wastes vertical space in the small popup/side-panel surfaces.
 *  Renders nothing outside the extension build. */
export function NavMenu({ store }: { store: WalletStore }) {
  // Open-state lives in the STORE (store.navMenuOpen) so it survives navigating to a
  // drawer shortcut and back — the drawer is already open again on return. Local
  // state only drives the slide animation (mount + transform phases).
  const open = store.navMenuOpen;
  const [mounted, setMounted] = useState(open); // drawer present in the DOM
  // `shown` also starts from `open`: when returning to a screen with the drawer
  // already open it renders INSTANTLY in place — the slide-in only plays for
  // fresh opens (closed -> open while this component is alive).
  const [shown, setShown] = useState(open);
  // Mounted with the drawer already open (a restore): kill the transform transition
  // entirely so there's no motion at all. Re-enabled after the first real close.
  const restoredRef = useRef(open);
  useEffect(() => {
    if (!open) restoredRef.current = false;
  }, [open]);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // double rAF: let the drawer paint off-screen first so the slide-in transitions
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const tm = setTimeout(() => setMounted(false), 340); // matches the transition below
    return () => clearTimeout(tm);
  }, [open]);
  if (buildKind() !== 'ext') return null;

  const tabs = navTabs(store.t);
  const activeKey = navActiveKey(store);
  const openDrawer = () => store.setNavMenuOpen(true);
  const closeDrawer = () => store.setNavMenuOpen(false);
  // Quick access: the scanner + settings + the profile shortcuts, one tap away.
  const shortcuts = [
    { key: 'scan', label: store.t('scan.scanQr'), glyph: '⛶' },
    ...(store.meta?.email ? [{ key: 'cosmospay', label: store.t('cosmospay.manage'), glyph: '◇' }] : []),
    { key: 'export', label: store.t('profile.exportKeys'), glyph: '⚷' },
    { key: 'receive', label: store.t('profile.receiveAddr'), glyph: '⛁' },
    { key: 'settings', label: store.t('profile.settings'), glyph: '⚙' },
    { key: 'about', label: store.t('profile.about'), glyph: '?' },
  ];

  return (
    <>
      <button onClick={openDrawer} aria-label="Menú" className="glass-soft circle-btn">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Restored already-open -> .is-instant kills the transition so there is
          absolutely no motion; fresh opens animate. */}
      {mounted && (
        <div className={cx('nav-drawer nav-menu-drawer', shown && 'is-open', restoredRef.current && 'is-instant')}>
          <div className="row between nav-menu-header">
            <div className="row g8 nav-menu-brand">
              <Logo size={22} />Cosmos Pay
            </div>
            <button onClick={closeDrawer} aria-label="Cerrar" className="glass-soft circle-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="scr col f1 nav-menu-list">
            {tabs.map((tb) => (
              <NavItem
                key={tb.key}
                lead={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink0">{tb.icon}</svg>}
                label={tb.label}
                on={tb.key === activeKey}
                onClick={() => {
                  closeDrawer();
                  if (tb.key !== activeKey) navGo(store, tb.key);
                }}
              />
            ))}

            <div className="nav-menu-divider" />
            {shortcuts.map((it) => (
              <NavItem
                key={it.key}
                lead={<span className="nav-menu-glyph">{it.glyph}</span>}
                label={it.label}
                // Deliberately NOT closing the drawer: its open-state persists in the
                // store, so pressing "back" on the destination lands here with the
                // menu already open — no need to reopen it.
                onClick={() => store.setScreen(it.key as Parameters<WalletStore['setScreen']>[0])}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
