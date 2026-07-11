import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { buildKind } from '@/lib/platform';
import { TOAST_EXIT_MS } from '@/constants/parts';
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
  const bg =
    shown.kind === 'ok'
      ? 'var(--accent)'
      : shown.kind === 'err'
      ? 'rgba(210,64,64,.92)'
      : 'var(--glass-bg)';
  const fg = shown.kind === 'ok' ? 'var(--on-accent)' : shown.kind === 'err' ? '#fff' : 'var(--text)';

  // Extension (popup/side panel): a bottom card that slides up for a moment and
  // slides back down — less intrusive than a centered overlay in a small surface.
  // Fixed to the viewport so it never sinks below the visible area (toast.css).
  if (buildKind() === 'ext') {
    return (
      <div className="toast-ext-wrap">
        <div
          key={shown.msg}
          className="toast-ext-card"
          style={{
            background: bg,
            color: fg,
            animation: leaving ? 'toastDown .23s ease forwards' : 'toastUp .3s cubic-bezier(.2,.9,.3,1)',
          }}
        >
          {shown.msg}
        </div>
      </div>
    );
  }

  return (
    // Flex-centered overlay so the card is centered from the first frame; only the
    // inner card scales in (animating transform on the card itself would fight the
    // centering and make it appear off to one side before snapping to the middle).
    <div className="toast-overlay">
      <div
        key={shown.msg}
        className="toast-card"
        style={{
          background: bg,
          color: fg,
          animation: leaving ? 'popOut .23s ease forwards' : 'pop .28s ease',
        }}
      >
        {shown.msg}
      </div>
    </div>
  );
}
