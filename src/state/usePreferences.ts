/**
 * Device preferences: theme, language, and the manual-signing toggle.
 *
 * Split out of the store hook, which was doing routing, session, network, prices,
 * history, CosmosPay, fiat, liquidity, toasts, theme and i18n in one 2100-line
 * function. These three share one trait that makes them a real slice: they persist
 * to local storage, apply to `document`, and depend on nothing else in the app.
 */
import { useCallback, useMemo, useState } from 'react';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '@/lib/i18n';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'cosmos.theme';
const CONFIRM_KEY = 'cosmos.confirm';

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Manual signing confirmations (password prompt before any signing action). Default ON. */
export function savedRequireConfirm(): boolean {
  try {
    return localStorage.getItem(CONFIRM_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Apply the persisted theme to <html> before first paint, so there is no flash. */
export function applySavedThemeEarly(): void {
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', savedTheme());
    }
  } catch {
    /* non-browser context */
  }
}

export function usePreferences(onLangChange: (message: string) => void) {
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const [lang, setLangState] = useState<Lang>(savedLang);
  const [requireConfirm, setRequireConfirmState] = useState<boolean>(savedRequireConfirm);

  const t = useMemo(() => makeT(lang), [lang]);
  const locale = useMemo(() => localeOf(lang), [lang]);

  const setRequireConfirm = useCallback((on: boolean) => {
    setRequireConfirmState(on);
    try {
      localStorage.setItem(CONFIRM_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    try {
      document.documentElement.setAttribute('data-theme', th);
      localStorage.setItem(THEME_KEY, th);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', th === 'light' ? '#eceef1' : '#080808');
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      persistLang(l);
      try {
        document.documentElement.setAttribute('lang', l);
      } catch {
        /* ignore */
      }
      const name = LANGUAGES.find((x) => x.code === l)?.name ?? l;
      // Announced through the caller's toast so this slice owns no UI of its own.
      onLangChange(makeT(l)('toast.langChanged', { lang: name }));
    },
    [onLangChange],
  );

  return { theme, setTheme, lang, setLang, t, locale, requireConfirm, setRequireConfirm };
}
