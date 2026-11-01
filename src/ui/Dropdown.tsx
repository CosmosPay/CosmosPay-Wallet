import { useEffect, useRef, useState, type ReactNode, type RefObject, type TransitionEvent } from 'react';
import { cx } from '@/lib/cx';
import '@/styles/ui/dropdown.css';

type Phase = 'closed' | 'mounting' | 'open' | 'closing';

/**
 * A panel that drops from its own trigger, for a desktop window — the counterpart of
 * `Sheet`, which rises from the bottom of a phone. The parent positions it: it sits in the
 * trigger's `position: relative` wrapper and opens under it, right-aligned, growing from
 * the trigger's corner.
 *
 * Controlled like `Sheet`: the parent owns `open`, and `onClose` asks it to flip. Escape,
 * a press outside (the trigger excepted — its own click toggles), and focus leaving the
 * panel all close it; Escape returns focus to the trigger. The child marked
 * `data-autofocus` gets focus on open. Both directions are transitions started a frame
 * after mount, so the first painted frame is the closed state (see Sheet.tsx for why).
 */
export function Dropdown({
  open,
  onClose,
  anchorRef,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** The trigger: presses on it are not "outside", and Escape gives focus back to it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The panel's accessible name. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('closed');

  useEffect(() => {
    if (open) {
      setPhase((p) => (p === 'closed' || p === 'closing' ? 'mounting' : p));
      return;
    }
    setPhase((p) => {
      if (p === 'closed' || p === 'closing') return p;
      const el = panel.current;
      return !el || parseFloat(getComputedStyle(el).transitionDuration) === 0 ? 'closed' : 'closing';
    });
  }, [open]);

  useEffect(() => {
    if (phase !== 'mounting') return;
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPhase('open'));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [phase]);

  // Escape and presses outside, only while it is up.
  useEffect(() => {
    if (phase !== 'mounting' && phase !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      anchorRef.current?.focus();
    };
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [phase, onClose, anchorRef]);

  const finish = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== panel.current || e.propertyName !== 'opacity' || phase !== 'closing') return;
    setPhase('closed');
  };

  if (phase === 'closed') return null;
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={cx('dropdown', phase === 'open' && 'is-open', className)}
      onTransitionEnd={finish}
      onBlur={(e) => {
        // Tabbing out of the panel closes it, unless focus went to the trigger.
        const next = e.relatedTarget as Node | null;
        if (next && !panel.current?.contains(next) && !anchorRef.current?.contains(next)) onClose();
      }}
    >
      {children}
    </div>
  );
}
