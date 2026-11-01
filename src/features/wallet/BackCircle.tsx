import type { WalletStore } from '@/state/store';
import { ArrowLeftIcon } from '@/ui/Icons';

/** Circular header back button (extension only — phone/web have the bottom bar).
 *  Returns to the screen the user actually came from — `goBack` is the only back
 *  handler in the app; it pops the real navigation stack. */
export function BackCircle({ store }: { store: WalletStore }) {
  return (
    <button type="button" onClick={store.goBack} className="glass-soft circle-btn" aria-label={store.t('a11y.back')}>
      <ArrowLeftIcon />
    </button>
  );
}
