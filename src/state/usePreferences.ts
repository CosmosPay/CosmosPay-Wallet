/**
 * Device preferences: theme, language, the manual-signing toggle, diagnostics, and the
 * swap screens' max slippage.
 *
 * Split out of the store hook, which was doing routing, session, network, prices,
 * history, CosmosPay, fiat, liquidity, toasts, theme and i18n in one 2100-line
 * function. These share one trait that makes them a real slice: they persist to local
 * storage, apply to `document` or to a module, and depend on nothing else in the app.
 *
 * Diagnostics is the one whose VALUE lives elsewhere: `lib/telemetry` owns the key,
 * because turning reporting off has to drop what is already queued, and a preference
 * slice writing the flag while the reporter kept its buffer would be an opt-out that
 * still sent the last few minutes.
 */
import { useCallback, useMemo, useState } from 'react';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '@/lib/i18n';
import { setTelemetryEnabled, telemetryEnabled } from '@/lib/telemetry';
import { clampSlippageBps, parseSlippagePref } from '@/lib/slippage';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'cosmos.theme';
const CONFIRM_KEY = 'cosmos.confirm';
const SLIPPAGE_KEY = 'cosmos.slippage';

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

/** The max slippage chosen in the swap sheet, or null for "auto" (each venue's default). */
export function savedSlippage(): number | null {
  try {
    return parseSlippagePref(localStorage.getItem(SLIPPAGE_KEY));
  } catch {
    return null;
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
  const [diagnostics, setDiagnosticsState] = useState<boolean>(telemetryEnabled);
  const [slippageBps, setSlippageState] = useState<number | null>(savedSlippage);

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

  const setDiagnostics = useCallback((on: boolean) => {
    setDiagnosticsState(on);
    setTelemetryEnabled(on);
  }, []);

  const setSlippageBps = useCallback((bps: number | null) => {
    const next = bps === null ? null : clampSlippageBps(bps);
    setSlippageState(next);
    try {
      if (next === null) localStorage.removeItem(SLIPPAGE_KEY);
      else localStorage.setItem(SLIPPAGE_KEY, String(next));
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
        ?.setAttribute('content', th === 'light' ? '#eceef1' : '#000000');
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

  return {
    theme,
    setTheme,
    lang,
    setLang,
    t,
    locale,
    requireConfirm,
    setRequireConfirm,
    diagnostics,
    setDiagnostics,
    slippageBps,
    setSlippageBps,
  };
}
