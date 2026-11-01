import { useEffect, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { TOAST_EXIT_MS } from '@/constants/ui';
import { cx } from '@/lib/cx';
import { CheckIcon, InfoIcon, WarningIcon } from '@/ui/Icons';
import '@/styles/app/toast.css';

/**
 * The app's one notification: a flat card that slides in, says one line, and slides away — at
 * the top of a phone (never over the actions at the bottom) and in the bottom-right corner of a
 * desktop window. Never in the middle of the screen, where it covered what the person had just
 * changed (switching the language announced itself over the very screen that had switched).
 *
 * The live region is always mounted and only its content changes, which is what makes a
 * screen reader announce it; an error is assertive, the rest polite.
 */
export function Toast({ toast }: { toast: WalletStore['toast'] }) {
  // Keep the last toast mounted while it animates out, so it doesn't vanish
  // abruptly when `toast` flips to null. `leaving` swaps the entrance for the exit;
  // once that finishes we unmount it (or a new toast interrupts it).
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
      }, TOAST_EXIT_MS); // must match the toastOut duration in toast.css
    }
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  // The extension's popup and side panel pin it to the viewport (see toast.css).
  const ext = buildKind() === 'ext';
  const kind = shown?.kind ?? 'info';
  return (
    <div className={cx('toast-wrap', ext && 'is-ext')} role={kind === 'err' ? 'alert' : 'status'} aria-live={kind === 'err' ? 'assertive' : 'polite'}>
      {shown && (
        <div key={shown.msg} className={cx('toast', `is-${shown.kind}`, leaving && 'is-leaving')}>
          {shown.kind === 'ok' ? (
            <CheckIcon className="toast-icon" />
          ) : shown.kind === 'err' ? (
            <WarningIcon className="toast-icon" />
          ) : (
            <InfoIcon className="toast-icon" />
          )}
          <span className="toast-msg">{shown.msg}</span>
        </div>
      )}
    </div>
  );
}
