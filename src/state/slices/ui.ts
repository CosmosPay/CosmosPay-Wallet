import { useCallback, useMemo, useRef, useState } from 'react';
import { LANGUAGES, localeOf, makeT, persistLang, savedLang, type Lang } from '@/lib/i18n';
import type { Screen, Tab, Toast, Theme } from '../store';

function savedTheme(): Theme {
  try {
    return localStorage.getItem('cosmos.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function savedRequireConfirm(): boolean {
  try {
    return localStorage.getItem('cosmos.confirm') !== 'off';
  } catch {
    return true;
  }
}

export function useUiSlice() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [tab, setTab] = useState<Tab>('home');
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const [lang, setLangState] = useState<Lang>(savedLang);
  const [requireConfirm, setRequireConfirmState] = useState<boolean>(savedRequireConfirm);
  const [confirmReq, setConfirmReq] = useState<{ title: string; message?: string } | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);

  const t = useMemo(() => makeT(lang), [lang]);
  const locale = useMemo(() => localeOf(lang), [lang]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const setRequireConfirm = useCallback((on: boolean) => {
    setRequireConfirmState(on);
    try {
      localStorage.setItem('cosmos.confirm', on ? 'on' : 'off');
    } catch {
    }
  }, []);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    try {
      document.documentElement.setAttribute('data-theme', th);
      localStorage.setItem('cosmos.theme', th);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', th === 'light' ? '#eceef1' : '#080808');
    } catch {
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
    try {
      document.documentElement.setAttribute('lang', l);
    } catch {
    }
    const name = LANGUAGES.find((x) => x.code === l)?.name ?? l;
    flash(makeT(l)('toast.langChanged', { lang: name }), 'info');
  }, [flash]);

  const requestSignature = useCallback(
    (opts: { title: string; message?: string }, force = false): Promise<boolean> => {
      if (!force && !savedRequireConfirm()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        confirmResolver.current = resolve;
        setConfirmReq(opts);
      });
    },
    []
  );

  const toggleConfirm = useCallback(async () => {
    const ok = await requestSignature({ title: t('confirmSig.settingTitle'), message: t('confirmSig.settingMsg') }, true);
    if (ok) setRequireConfirm(!savedRequireConfirm());
  }, [requestSignature, setRequireConfirm, t]);

  const resolveConfirm = useCallback((okSig: boolean) => {
    setConfirmReq(null);
    const r = confirmResolver.current;
    confirmResolver.current = null;
    r?.(okSig);
  }, []);

  return {
    screen, setScreen, tab, setTab, navMenuOpen, setNavMenuOpen, toast, flash,
    loading, setLoading, busy, setBusy, theme, setTheme, lang, setLang, t, locale,
    requireConfirm, setRequireConfirm, confirmReq, requestSignature, toggleConfirm, resolveConfirm
  };
}
