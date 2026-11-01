/**
 * Device preferences: theme, language, the manual-signing toggle, the idle auto-lock, and
 * diagnostics.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '@/lib/i18n';
import { setTelemetryEnabled, telemetryEnabled } from '@/lib/telemetry';
import { AUTO_LOCK_CHOICES_MS, AUTO_LOCK_KEY, DEFAULT_AUTO_LOCK_MS, type AutoLockMs } from '@/constants/app';

/** What is painted. */
export type Theme = 'dark' | 'light';
/** What the person chose. `system` follows the device and is the default: a first run
 *  opens in the phone's own theme, and only an explicit choice pins one. */
export type ThemePref = Theme | 'system';

/**
 * public/theme-boot.js holds its own copies of these two (it runs before any module, so
 * the first paint already has the right canvas); tests/unit/themeBoot.test.ts keeps them
 * equal.
 */
export const THEME_KEY = 'cosmos.theme';
/** The browser chrome colour per theme: each theme's --bg (src/styles/theme.css). */
export const THEME_COLOR: Record<Theme, string> = { dark: '#000000', light: '#ffffff' };
const CONFIRM_KEY = 'cosmos.confirm';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function savedThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(pref: ThemePref): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

/** Paint a theme: tokens through `data-theme`, and the browser chrome to match. */
function paintTheme(th: Theme): void {
  try {
    document.documentElement.setAttribute('data-theme', th);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[th]);
  } catch {
    /* non-browser context */
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

/** How long an idle session stays open (constants/app.ts). Anything but a listed choice is the default. */
export function savedAutoLockMs(): AutoLockMs {
  try {
    const v = Number(localStorage.getItem(AUTO_LOCK_KEY));
    return (AUTO_LOCK_CHOICES_MS as readonly number[]).includes(v) ? (v as AutoLockMs) : DEFAULT_AUTO_LOCK_MS;
  } catch {
    return DEFAULT_AUTO_LOCK_MS;
  }
}

/** Apply the persisted theme to <html> as soon as the store module loads. The first paint
 *  is public/theme-boot.js's; this covers a shell that does not load it (the extension's
 *  approval window). */
export function applySavedThemeEarly(): void {
  if (typeof document !== 'undefined') paintTheme(resolveTheme(savedThemePref()));
}

export function usePreferences(onLangChange: (message: string) => void) {
  const [themePref, setThemePrefState] = useState<ThemePref>(savedThemePref);
  const [deviceTheme, setDeviceTheme] = useState<Theme>(systemTheme);
  const theme: Theme = themePref === 'system' ? deviceTheme : themePref;
  const [lang, setLangState] = useState<Lang>(savedLang);
  const [requireConfirm, setRequireConfirmState] = useState<boolean>(savedRequireConfirm);
  const [diagnostics, setDiagnosticsState] = useState<boolean>(telemetryEnabled);
  const [autoLockMs, setAutoLockMsState] = useState<AutoLockMs>(savedAutoLockMs);

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

  const setAutoLockMs = useCallback((ms: AutoLockMs) => {
    setAutoLockMsState(ms);
    try {
      localStorage.setItem(AUTO_LOCK_KEY, String(ms));
    } catch {
      /* ignore */
    }
  }, []);

  const setDiagnostics = useCallback((on: boolean) => {
    setDiagnosticsState(on);
    setTelemetryEnabled(on);
  }, []);

  // The device's theme can change under an open app (a scheduled dark mode, the quick
  // setting); a `system` preference follows it live.
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(LIGHT_QUERY);
    } catch {
      return;
    }
    const onChange = () => setDeviceTheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // A flip the person (or the device) makes cross-fades, with the motion tokens' timing
  // (animations.css); the first paint is the boot script's and does not animate.
  const painted = useRef(false);
  useEffect(() => {
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (painted.current && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => paintTheme(theme));
    } else {
      paintTheme(theme);
    }
    painted.current = true;
  }, [theme]);

  /** `system` forgets the stored choice rather than storing the word, so a device that
   *  never chose keeps following the phone. */
  const setThemePref = useCallback((pref: ThemePref) => {
    setThemePrefState(pref);
    try {
      if (pref === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
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
    themePref,
    setThemePref,
    lang,
    setLang,
    t,
    locale,
    requireConfirm,
    setRequireConfirm,
    diagnostics,
    setDiagnostics,
    autoLockMs,
    setAutoLockMs,
  };
}
