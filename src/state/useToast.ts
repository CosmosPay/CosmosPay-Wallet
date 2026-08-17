/**
 * Transient notifications.
 *
 * Its own slice because `flash` is called from ~40 places across the store and every
 * one of them only needs this: a message, a kind, and auto-dismissal. The timer is
 * cleared on unmount — the previous version left a `setTimeout` firing into a torn
 * down tree when the popup closed mid-toast.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  msg: string;
  kind: 'ok' | 'err' | 'info';
}

/** How long a toast stays up. Matches the exit animation in animations.css. */
const TOAST_MS = 2600;

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    setToast({ msg, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, flash };
}
