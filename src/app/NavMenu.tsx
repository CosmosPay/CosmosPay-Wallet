import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { ChevronRightIcon, CloseIcon, CosmosMark, InfoCircleIcon, KeyIcon, LinkIcon, MenuIcon, QrIcon, GearIcon } from '@/ui/Icons';
import { navTabs, navActiveKey, navGo } from '@/app/navModel';
import { cx } from '@/lib/cx';
import '@/styles/app/nav-menu.css';

/** Both drawer sections share ONE row: a line icon, the name, a chevron. The place you are
 *  on is marked like the bar marks it — ink and the brand blue's line. */
function NavItem({ lead, label, on, onClick }: { lead: ReactNode; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={on ? 'page' : undefined} className={cx('nav-menu-item', on && 'is-on')}>
      <span className="nav-menu-lead" aria-hidden="true">
        {lead}
      </span>
      <span className="f1 nav-menu-item-label">{label}</span>
      <ChevronRightIcon className="nav-menu-chevron" />
    </button>
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
    ...(store.meta?.email ? [{ key: 'cosmospay', label: store.t('cosmospay.manage'), icon: <LinkIcon /> }] : []),
    { key: 'export', label: store.t('profile.exportKeys'), icon: <KeyIcon /> },
    { key: 'receive', label: store.t('profile.receiveAddr'), icon: <QrIcon /> },
    { key: 'settings', label: store.t('profile.settings'), icon: <GearIcon /> },
    { key: 'about', label: store.t('profile.about'), icon: <InfoCircleIcon /> },
  ];

  return (
    <>
      <button type="button" onClick={openDrawer} aria-label={store.t('a11y.menu')} className="glass-soft circle-btn">
        <MenuIcon />
      </button>

      {/* Restored already-open -> .is-instant kills the transition so there is
          absolutely no motion; fresh opens animate. */}
      {mounted && (
        <div className={cx('nav-drawer nav-menu-drawer', shown && 'is-open', restoredRef.current && 'is-instant')}>
          <div className="row between nav-menu-header">
            {/* The logo goes home, inside the session, like the desktop rail's. */}
            <button
              type="button"
              className="row g8 nav-menu-brand"
              aria-label={store.t('error.goHome')}
              onClick={() => {
                closeDrawer();
                navGo(store, 'home');
              }}
            >
              <CosmosMark className="nav-menu-mark" />
              Cosmos Wallet
            </button>
            <button type="button" onClick={closeDrawer} aria-label={store.t('a11y.close')} className="glass-soft circle-btn">
              <CloseIcon />
            </button>
          </div>

          <div className="scr col f1 nav-menu-list">
            {tabs.map((tb) => (
              <NavItem
                key={tb.key}
                lead={tb.icon}
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
                lead={it.icon}
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
