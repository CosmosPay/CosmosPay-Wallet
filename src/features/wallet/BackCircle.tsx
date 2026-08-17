import type { WalletStore } from '@/state/store';

/** Circular header back button (extension only — phone/web have the bottom bar).
 *  Returns to the screen the user actually came from — `goBack` is the only back
 *  handler in the app; it pops the real navigation stack. */
export function BackCircle({ store }: { store: WalletStore }) {
  return (
    <div onClick={store.goBack} className="tap glass-soft circle-btn" title={store.t('tab.home')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}
