import type { ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';
import { ConfirmSign } from './ConfirmSign';
import '@/styles/components/shell.css';

/** The phone column with the signature glow + blurred blobs.
 *  The wrapper/frame sizing rules (and the MV3 popup + Chrome `zoom` crash
 *  workarounds they encode) are documented in shell.css. */
export function Shell({
  children,
  showGlow = true,
  showNav = false,
  store,
}: {
  children: ReactNode;
  showGlow?: boolean;
  showNav?: boolean;
  store?: WalletStore;
}) {
  return (
    <div className="shell-root">
      <div className="shell-frame">
        {showGlow && <div className="cosmos-glow shell-glow" />}
        <div className="shell-blobs">
          <Blob anim="cosmos-blob-a" top="-70px" left="-50px" size="320px" color="var(--blob)" blur="90px" />
          <Blob anim="cosmos-blob-b" bottom="140px" right="-80px" size="300px" color="var(--blob)" blur="95px" />
          <Blob anim="cosmos-blob-c" bottom="-50px" left="-40px" size="280px" color="var(--blob)" blur="85px" />
        </div>

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

function Blob(p: {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  size: string;
  color: string;
  blur: string;
  anim?: string;
}) {
  return (
    <div
      className={`shell-blob${p.anim ? ` ${p.anim}` : ''}`}
      style={{
        // per-instance placement/size/tint — all props, so they stay inline
        top: p.top,
        bottom: p.bottom,
        left: p.left,
        right: p.right,
        width: p.size,
        height: p.size,
        background: p.color,
        filter: `blur(${p.blur})`,
      }}
    />
  );
}
