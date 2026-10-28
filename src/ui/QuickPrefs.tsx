import { useId, useState } from 'react';
import { LANGUAGES, type Lang, type TFn } from '@/lib/i18n';
import { inkHandlers } from '@/lib/ink';
import { cx } from '@/lib/cx';
import type { Theme } from '@/state/usePreferences';
import { Sheet } from '@/ui/Sheet';
import { CheckIcon, ChevronDownIcon, CloseIcon, ThemeIcon } from '@/ui/Icons';
import { LangFlag } from '@/ui/LangFlag';
import '@/styles/ui/quick-prefs.css';

/**
 * Language and theme, one tap away, top-right of Welcome and Unlock: someone who cannot
 * read the first screen changes it before anything else, without waiting for Settings.
 * Not repeated on the steps after Welcome — the choice carries through the flow.
 *
 * Language: the button shows the language's flag and its name in that language, and opens
 * a bottom sheet listing every language the same way (flags: src/ui/LangFlag.tsx). Theme: one tap flips light and dark
 * with no menu; the icon is the theme it switches TO. Settings keeps the full choice,
 * system included.
 */
export function QuickPrefs({
  t,
  lang,
  onLang,
  theme,
  onTheme,
  className,
}: {
  t: TFn;
  lang: Lang;
  onLang: (l: Lang) => void;
  theme: Theme;
  onTheme: (th: Theme) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const themeLabel = t(next === 'light' ? 'prefs.toLight' : 'prefs.toDark');

  return (
    <div className={cx('quick-prefs', className)}>
      <button
        type="button"
        className="quick-prefs-lang ink"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('prefs.language', { lang: current.name })}
        onClick={() => setOpen(true)}
        {...inkHandlers}
      >
        <LangFlag code={current.code} />
        <span lang={current.code}>{current.name}</span>
        <ChevronDownIcon className="quick-prefs-chevron" />
      </button>

      <button
        type="button"
        className="quick-prefs-theme ink"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => onTheme(next)}
        {...inkHandlers}
      >
        <ThemeIcon kind={next === 'light' ? 'sun' : 'moon'} className="quick-prefs-icon" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('settings.language')}
          </h2>
          <button
            type="button"
            className="sheet-close ink"
            aria-label={t('a11y.close')}
            onClick={() => setOpen(false)}
            {...inkHandlers}
          >
            <CloseIcon />
          </button>
        </div>
        <ul className="quick-prefs-list">
          {LANGUAGES.map((l) => {
            const on = l.code === lang;
            return (
              <li key={l.code}>
                <button
                  type="button"
                  lang={l.code}
                  aria-current={on ? 'true' : undefined}
                  data-autofocus={on ? '' : undefined}
                  className={cx('quick-prefs-opt', on && 'is-on')}
                  onClick={() => {
                    if (!on) onLang(l.code);
                    setOpen(false);
                  }}
                >
                  <LangFlag code={l.code} />
                  <span className="f1">{l.name}</span>
                  {on && <CheckIcon className="quick-prefs-check" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}
