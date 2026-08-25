import { useEffect } from 'react';
import { watchKeyboard } from '@/lib/viewport';

/**
 * Keep `--kb-h` and the `kb-open` class on <html> in step with the on-screen keyboard,
 * for as long as the app is mounted. Mount it once, at the shell.
 *
 * The measuring lives in `@/lib/viewport` and holds no React state — this is only the
 * lifecycle, which is the one part that needs a component.
 */
export function useKeyboardInset() {
  useEffect(() => watchKeyboard(), []);
}
