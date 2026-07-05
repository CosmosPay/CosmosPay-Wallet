import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';

/** Extension-only: toggle between popup and side-panel as the wallet's surface.
 *  The choice PERSISTS: on Chrome, sidePanel.setPanelBehavior() rewires the toolbar
 *  icon itself (browser-remembered across restarts), so reopening the wallet lands
 *  on the preferred surface without re-picking. Renders nothing outside the extension. */
export function SurfaceToggle({ store }: { store: WalletStore }) {
  if (buildKind() !== 'ext') return null;
  const inSidebar = typeof location !== 'undefined' && location.pathname.includes('sidepanel');
  const ext = (globalThis as unknown as { chrome?: any; browser?: any });
  const api = ext.chrome ?? ext.browser;

  const toggle = async () => {
    try {
      localStorage.setItem('cosmos.surface', inSidebar ? 'popup' : 'sidebar');
    } catch {
      /* ignore */
    }
    if (!inSidebar) {
      // -> sidebar mode: the action icon now opens the side panel (persists), and we
      // open it right away (still inside the click's user gesture), closing the popup.
      try {
        await api?.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
        const win = await api?.windows?.getCurrent?.();
        await api?.sidePanel?.open?.({ windowId: win?.id });
      } catch {
        // Firefox: no sidePanel API — open its sidebar instead (user gesture required).
        try {
          await ext.browser?.sidebarAction?.open?.();
        } catch {
          /* ignore */
        }
      }
      window.close();
    } else {
      // -> popup mode: the action icon opens the popup again; close this panel.
      try {
        await api?.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
      } catch {
        /* Firefox — nothing to rewire */
      }
      try {
        await ext.browser?.sidebarAction?.close?.();
      } catch {
        /* ignore */
      }
      window.close();
    }
  };

  return (
    <button
      onClick={toggle}
      title={store.t(inSidebar ? 'surface.toPopup' : 'surface.toSidebar')}
      aria-label={store.t(inSidebar ? 'surface.toPopup' : 'surface.toSidebar')}
      className="glass-soft circle-btn"
    >
      {inSidebar ? (
        // in the sidebar -> icon shows a small popup window
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <rect x="11" y="6" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : (
        // in the popup -> icon shows a right side panel
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15 3v18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      )}
    </button>
  );
}
