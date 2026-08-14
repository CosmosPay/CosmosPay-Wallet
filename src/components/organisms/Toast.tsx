import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { TOAST_EXIT_MS } from '@/constants/parts';
import { cx } from '@/lib/cx';
import '@/styles/components/toast.css';

export function Toast({ toast }: { toast: WalletStore['toast'] }) {
  // Keep the last toast mounted while it animates out, so it doesn't vanish
  // abruptly when `toast` flips to null. `leaving` swaps the entrance pop for
  // an exit popOut; once that finishes we unmount (or a new toast interrupts it).
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    if (toast) {
      setShown(toast);
      setLeaving(false);
    } else if (shown) {
      setLeaving(true);
      exitTimer.current = setTimeout(() => {
        setShown(null);
        setLeaving(false);
      }, TOAST_EXIT_MS); // must match the popOut/toastDown duration below
    }
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  if (!shown) return null;
  // Surface by kind + the exit swap, both as modifier classes (toast.css).
  const ext = buildKind() === 'ext';
  // Extension (popup/side panel): a bottom card that slides up for a moment and
  // slides back down — less intrusive than a centered overlay in a small surface,
  // and fixed to the viewport so it never sinks below the visible area.
  // Elsewhere: a flex-centered overlay so the card is centred from the first frame
  // (animating transform on the card itself would fight the centring and make it
  // appear off to one side before snapping to the middle).
  return (
    <div className={ext ? 'toast-ext-wrap' : 'toast-overlay'}>
      <div
        key={shown.msg}
        className={cx(
          ext ? 'toast-ext-card' : 'toast-card',
          shown.kind === 'ok' && 'is-ok',
          shown.kind === 'err' && 'is-err',
          leaving && 'is-leaving',
        )}
      >
        {shown.msg}
      </div>
    </div>
  );
}
