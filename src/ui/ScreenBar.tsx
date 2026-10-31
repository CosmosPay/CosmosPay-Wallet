import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { tNow } from '@/lib/i18n';
import { ArrowLeftIcon } from '@/ui/Icons';
import '@/styles/ui/screen-bar.css';

interface ScreenBarApi {
  claim: (back: () => void) => void;
  release: (back: () => void) => void;
}

const ScreenBarContext = createContext<ScreenBarApi | null>(null);

/**
 * The way back, drawn by the shell above the screen rather than by the screen (the user's
 * call): it stays put at the top left while the steps change under it — no entrance
 * animation, no scrolling with the content, the same place on every step. On a phone that is
 * the column's corner; on a desktop window it is the WINDOW's top-left corner, mirroring the
 * language and theme controls in the top-right one (src/styles/app/shell.css). A screen asks
 * for it through `ScreenHeader` (`useScreenBack`); on a screen that does not, the bar is empty.
 *
 * The button is one element for as long as consecutive screens want it: the screen leaving
 * releases it and the one arriving claims it in the same commit, before anything is painted.
 */
export function ScreenBarHost({ children }: { children: ReactNode }) {
  const handler = useRef<(() => void) | null>(null);
  const [shown, setShown] = useState(false);
  const api = useMemo<ScreenBarApi>(
    () => ({
      claim: (back) => {
        handler.current = back;
        setShown(true);
      },
      release: (back) => {
        if (handler.current !== back) return;
        handler.current = null;
        setShown(false);
      },
    }),
    [],
  );
  return (
    <ScreenBarContext.Provider value={api}>
      <div className={cx('screen-bar', shown && 'is-shown')}>
        {shown && (
          <button
            type="button"
            className="screen-bar-back ink"
            aria-label={tNow('a11y.back')}
            onClick={() => handler.current?.()}
            {...inkHandlers}
          >
            <ArrowLeftIcon className="screen-bar-back-icon" />
          </button>
        )}
      </div>
      {children}
    </ScreenBarContext.Provider>
  );
}

/**
 * Put `onBack` on the shell's bar while the calling screen is mounted. Returns whether there
 * is a bar to put it on — outside a shell the caller draws its own.
 */
export function useScreenBack(onBack: (() => void) | undefined): boolean {
  const api = useContext(ScreenBarContext);
  const latest = useRef(onBack);
  latest.current = onBack;
  const stable = useCallback(() => latest.current?.(), []);
  const wants = !!onBack;
  useLayoutEffect(() => {
    if (!api || !wants) return;
    api.claim(stable);
    return () => api.release(stable);
  }, [api, wants, stable]);
  return !!api;
}
