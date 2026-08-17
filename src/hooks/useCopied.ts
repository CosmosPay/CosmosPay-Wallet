import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { COPY_FEEDBACK_MS } from '@/constants/ui';

/**
 * Copy a value to the clipboard and raise a "copied" flag for a moment, so the
 * button can swap its label/colour.
 *
 * `key` tells several buttons apart when one screen reveals more than one secret
 * (Export). With a single button the returned key is simply truthy while the
 * flag is up. The timer is cleared on unmount — the hand-rolled `setTimeout`
 * this replaces kept firing into unmounted screens.
 */
export function useCopied(ms = COPY_FEEDBACK_MS) {
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(
    async (value: string, key = 'copied') => {
      await copyText(value);
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(''), ms);
    },
    [ms],
  );
  return [copied, copy] as const;
}
