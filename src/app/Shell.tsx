import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { BottomNav } from '@/app/BottomNav';
import { DesktopNav } from '@/app/DesktopNav';
import { Toast } from '@/app/Toast';
import { ConfirmSign } from '@/app/ConfirmSign';
import { AuthAside } from '@/app/AuthAside';
import { AUTH_SCREENS, SCREENS } from '@/lib/screens';
import { ScreenBarHost } from '@/ui/ScreenBar';
import { cx } from '@/lib/cx';
import { forwardScrollKey, forwardWheel } from '@/lib/scrollForward';
import '@/styles/app/shell.css';
import '@/styles/app/auth-split.css';

/** The frame that hosts the app: a phone column, or — past `--desk-min` — the whole screen.
 *
 *  The sizing rules for both (and the MV3 popup + Chrome `zoom` crash workarounds they
 *  encode) are documented in shell.css; the desktop mode itself is documented in theme.css.
 *
 *  WHICH NAVIGATION SHOWS IS DECIDED IN CSS, not here. Both `DesktopNav` and `BottomNav`
 *  go into the DOM and a media query hides one of them, so there is no resize listener in
 *  the app and nothing that can disagree with itself between the server-rendered shell and
 *  the hydrated one. What JS answers is the part a media query cannot: which BUILD this is
 *  (`has-desktop-mode` — the extension is excluded by class rather than by width, because a
 *  side panel can be dragged past the breakpoint), and whether there is a session to
 *  navigate at all. */
export function Shell({
  children,
  showNav = false,
  store,
}: {
  children: ReactNode;
  showNav?: boolean;
  store?: WalletStore;
}) {
  // The extension gets neither of these: it navigates via <NavMenu/> — a hamburger in each
  // tab screen's header opening a full-view drawer — because a fixed bar wastes vertical
  // space in the popup, and because a side panel the user has dragged past 1024px must
  // stay one column rather than sprouting a rail it has no room for.
  const chrome = buildKind() !== 'ext';
  // The rail is tied to the SESSION, not to `showNav`. See DesktopNav's header: a rail that
  // came and went on every navigation would reflow the whole window, where the bottom bar
  // it replaces only ever floated over the content.
  const rail = chrome && !!store?.hasSession;
  // Before a session, the desktop window splits: the flow on the left, the brand panel on
  // the right (AuthAside). Whether it SHOWS is CSS, like the rail.
  const authSplit = chrome && !!store && !store.hasSession && AUTH_SCREENS.includes(store.screen);
  // A screen with its own desktop layout (`wide` in the screen table) gets the wide column
  // beside the rail; every other one keeps the reading column. Whether it APPLIES is CSS.
  const wide = rail && !!store && SCREENS[store.screen]?.wide === true;

  // The top safe zone's edge: once the screen has scrolled, a hairline marks where its content
  // goes under the strip above it (wallet-app.css), instead of text simply cut in half there.
  // Scroll does not bubble, so it is caught on the way down; a new screen starts unscrolled.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains('screen')) setScrolled(el.scrollTop > 0);
  };
  const screen = store?.screen;
  useEffect(() => setScrolled(false), [screen]);

  // The screen scrolls from anywhere in the window — the margins beside its column, the brand
  // panel — and with the scroll keys when no control has the focus (lib/scrollForward.ts).
  // Not in the extension, whose popup is the column. Passive: nothing here cancels a wheel.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!chrome || !root) return;
    const onWheel = (e: WheelEvent) => forwardWheel(e, root);
    const onKey = (e: KeyboardEvent) => forwardScrollKey(e, root);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [chrome]);

  return (
    <div ref={rootRef} className={cx('shell-root', chrome && 'has-desktop-mode', rail && 'has-rail', authSplit && 'has-auth-split')}>
      <div className="shell-frame">
        {rail && store && <DesktopNav store={store} />}

        <div className="shell-main">
          <div className={cx('shell-content', wide && 'is-wide', scrolled && 'is-scrolled')} onScrollCapture={onScroll}>
            {/* The way back, above the screen so it never moves with it (ui/ScreenBar). */}
            <ScreenBarHost>{children}</ScreenBarHost>
          </div>
        </div>

        {authSplit && store && <AuthAside store={store} />}

        {showNav && store && chrome && <BottomNav store={store} />}
        {store && <Toast toast={store.toast} />}
        {/* Not gated on hasSession, and the reason is that the gate is: `lock()` calls
            `cancelPending()`, which answers every queued request `false` in the same
            batch as `setSession(null)`, so by the time this could re-render there is
            nothing left to render. A `hasSession` condition here would be a second
            place to keep that invariant, not a stronger one. */}
        {store && <ConfirmSign store={store} />}
      </div>
    </div>
  );
}
