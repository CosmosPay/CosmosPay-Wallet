import { useCallback, useId, useRef, useState } from 'react';
import { LANGUAGES, type Lang, type TFn } from '@/lib/i18n';
import { inkHandlers } from '@/lib/ink';
import { isDesktopLayout } from '@/lib/layout';
import { cx } from '@/lib/cx';
import type { Theme } from '@/state/usePreferences';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { CheckIcon, ChevronDownIcon, CloseIcon, ThemeIcon } from '@/ui/Icons';
import { LangFlag } from '@/ui/LangFlag';
import '@/styles/ui/quick-prefs.css';

/**
 * Language and theme, one tap away, top-right of Welcome and Unlock (on a desktop window,
 * of the brand panel beside them): someone who cannot read the first screen changes it
 * before anything else, without waiting for Settings.
 *
 * Language: the button shows the language's flag and its name in that language, and lists
 * every language the same way (flags: src/ui/LangFlag.tsx) — in a dropdown under the
 * button on a desktop window, in a bottom sheet on a phone. Theme: one tap flips light and
 * dark with no menu; the icon is the theme it switches TO. Settings keeps the full choice,
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
  const [open, setOpen] = useState<'sheet' | 'menu' | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const themeLabel = t(next === 'light' ? 'prefs.toLight' : 'prefs.toDark');

  // One list for both containers.
  const options = (
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
                close();
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
  );

  return (
    <div className={cx('quick-prefs', className)}>
      <div className="quick-prefs-lang-wrap">
        <button
          ref={trigger}
          type="button"
          className="quick-prefs-lang ink"
          aria-haspopup="dialog"
          aria-expanded={open !== null}
          aria-label={t('prefs.language', { lang: current.name })}
          onClick={() => setOpen((o) => (o ? null : isDesktopLayout() ? 'menu' : 'sheet'))}
          {...inkHandlers}
        >
          <LangFlag code={current.code} />
          <span lang={current.code}>{current.name}</span>
          <ChevronDownIcon className="quick-prefs-chevron" />
        </button>
        <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('settings.language')}>
          {options}
        </Dropdown>
      </div>

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

      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('settings.language')}
          </h2>
          <button
            type="button"
            className="sheet-close ink"
            aria-label={t('a11y.close')}
            onClick={close}
            {...inkHandlers}
          >
            <CloseIcon />
          </button>
        </div>
        {options}
      </Sheet>
    </div>
  );
}
