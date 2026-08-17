import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { BottomNav } from '@/app/BottomNav';
import { Toast } from '@/app/Toast';
import { ConfirmSign } from '@/app/ConfirmSign';
import '@/styles/app/shell.css';

/** The phone column that hosts the app.
 *  The wrapper/frame sizing rules (and the MV3 popup + Chrome `zoom` crash
 *  workarounds they encode) are documented in shell.css. */
export function Shell({
  children,
  showNav = false,
  store,
}: {
  children: ReactNode;
  showNav?: boolean;
  store?: WalletStore;
}) {
  return (
    <div className="shell-root">
      <div className="shell-frame">
        <div className="shell-content">{children}</div>

        {/* Phone/web only: bottom tab bar. The extension navigates via <NavMenu/> — a
            hamburger in each tab screen's header opening a full-view drawer — because
            a fixed bottom bar wastes vertical space in the popup/side panel. */}
        {showNav && store && buildKind() !== 'ext' && <BottomNav store={store} />}
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
