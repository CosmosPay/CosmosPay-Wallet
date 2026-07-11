import type { ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';
import { ConfirmSign } from './ConfirmSign';
import '@/styles/components/shell.css';

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
        {store && <ConfirmSign store={store} />}
      </div>
    </div>
  );
}
