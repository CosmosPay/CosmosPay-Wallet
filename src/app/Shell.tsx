import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { BottomNav } from '@/app/BottomNav';
import { DesktopNav } from '@/app/DesktopNav';
import { Toast } from '@/app/Toast';
import { ConfirmSign } from '@/app/ConfirmSign';
import { cx } from '@/lib/cx';
import '@/styles/app/shell.css';

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

  return (
    <div className={cx('shell-root', chrome && 'has-desktop-mode')}>
      <div className="shell-frame">
        {rail && store && <DesktopNav store={store} />}

        <div className="shell-main">
          <div className="shell-content">{children}</div>
        </div>

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
