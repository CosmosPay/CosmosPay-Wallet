import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type TransitionEvent } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/sheet.css';

type Phase = 'closed' | 'mounting' | 'open' | 'closing';

/**
 * Bottom sheet on the native `<dialog>`. `showModal()` brings the focus trap, Escape, an
 * inert page behind and the top layer with it, in every shell the wallet runs in (popup,
 * side panel, WebView, tab), so none of that is re-implemented here.
 *
 * Controlled: the parent owns `open` and `onClose` asks it to flip. Both directions are CSS
 * transitions, and the way in is what makes it work everywhere: the dialog is shown with the
 * panel parked below the screen, and `is-open` is added two frames LATER, so the first frame
 * a phone paints is the starting position. Opening with a keyframe animation in the same
 * frame as `showModal()` let a slow device drop the front of the slide, and the sheet
 * seemed to just appear. Closing removes `is-open`, and the dialog really closes when that
 * transition ends. Closing returns focus to whatever opened the sheet (the dialog's own focus
 * restoration). The child marked `data-autofocus` gets focus on open.
 *
 * The children are always rendered (the closed dialog paints nothing): mounting them on
 * open put their render, layout and first paint into the very frames the slide needed,
 * and the first opening dropped frames.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Id of the sheet's visible title. */
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(open ? 'mounting' : 'closed');

  useEffect(() => {
    if (open) {
      setPhase((p) => (p === 'closed' || p === 'closing' ? 'mounting' : p));
      return;
    }
    setPhase((p) => {
      if (p === 'closed' || p === 'closing') return p;
      // No transition to wait for (the engine has none, or it is switched off): close now,
      // or the dialog would never close.
      const el = panel.current;
      if (!el || parseFloat(getComputedStyle(el).transitionDuration) === 0) {
        ref.current?.close();
        return 'closed';
      }
      return 'closing';
    });
  }, [open]);

  // Show the dialog with the panel still parked, then slide it in two frames later.
  useEffect(() => {
    if (phase !== 'mounting') return;
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
      // Without scrolling: the panel is still parked below the screen, and scrolling to
      // the focused control would cancel the slide (see sheet.css). The reset covers the
      // focus `showModal()` itself moves in, for an engine that still scrolls on it.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPhase('open'));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [phase]);

  const finish = (e: TransitionEvent<HTMLDivElement>) => {
    // Only the panel's own slide; the controls inside it transition too.
    if (e.target !== panel.current || e.propertyName !== 'transform' || phase !== 'closing') return;
    ref.current?.close();
    setPhase('closed');
  };

  // The dialog spans the viewport and the panel sits at its bottom: a click that lands on
  // the dialog itself landed on the scrim.
  const onScrim = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className={cx('sheet', phase === 'open' && 'is-open')}
      onClick={onScrim}
      onCancel={(e) => {
        // Escape: slide out like every other way of closing.
        e.preventDefault();
        onClose();
      }}
    >
      <div ref={panel} className="sheet-panel" onTransitionEnd={finish}>
        <div className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </dialog>
  );
}
