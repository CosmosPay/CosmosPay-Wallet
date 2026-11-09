import { useId } from 'react';
import type { WalletStore } from '@/state/store';
import type { ThemePref } from '@/state/usePreferences';
import { THEME_OPTIONS } from '@/constants/settings';
import { ThemeIcon } from '@/ui/Icons';
import '@/styles/features/settings/theme-selector.css';

export function ThemeSelector({ value, onChange, t }: {
  value: ThemePref;
  onChange: (value: ThemePref) => void;
  t: WalletStore['t'];
}) {
  const name = useId();
  return (
    <div className="settings-theme" role="group" aria-label={t('settings.appearance')}>
      {THEME_OPTIONS.map((option) => (
        <label key={option.id} className="settings-theme-option" title={t(option.labelKey)}>
          <input className="sr-only" type="radio" name={name} value={option.id}
            checked={value === option.id} onChange={() => onChange(option.id)} />
          <span className="settings-theme-content">
            <ThemeIcon kind={option.icon} />
            <span className="sr-only">{t(option.labelKey)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
