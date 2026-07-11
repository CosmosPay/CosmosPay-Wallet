import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { SettingsSection } from '@/components/molecules/settings/SettingsSection';
import { ENDPOINT_FIELDS, devModeEnabled, setDevMode, getOverrides, setOverride, resetOverrides, type EndpointOverrides } from '@/lib/endpoints';
import '@/styles/screens/settings/settings.css';

/** Developer mode: live-overridable endpoints (prices API, Developer Platform,
 *  payments gateway). Persisted in localStorage; getters in lib/endpoints resolve
 *  per request, so changes apply immediately. Empty field = default value. */
export function DevModeSection({ store }: { store: WalletStore }) {
  const t = store.t;
  const [on, setOn] = useState(devModeEnabled());
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const ov = getOverrides();
    return Object.fromEntries(ENDPOINT_FIELDS.map((f) => [f.key, ov[f.key] ?? '']));
  });

  const toggle = () => {
    const next = !on;
    setOn(next);
    setDevMode(next);
  };
  const change = (key: keyof EndpointOverrides, v: string) => {
    setVals((s) => ({ ...s, [key]: v }));
    setOverride(key, v);
  };
  const reset = () => {
    resetOverrides();
    setVals(Object.fromEntries(ENDPOINT_FIELDS.map((f) => [f.key, ''])));
  };

  return (
    <SettingsSection title={t('settings.devMode')}>
      <div onClick={toggle} className="tap glass row between settings-tile">
        <span className="settings-devmode-label">{t('settings.devMode')}</span>
        <div className={on ? 'settings-switch settings-switch-sm is-on' : 'settings-switch settings-switch-sm'}>
          <div className="settings-switch-knob" />
        </div>
      </div>

      {on && (
        <div className="settings-subform">
          <div className="settings-dev-desc">{t('settings.devModeDesc')}</div>
          {ENDPOINT_FIELDS.map((f) => (
            <label key={f.key} className="settings-dev-field">
              <div className="label-up settings-dev-field-label">{t(f.labelKey)}</div>
              <input
                value={vals[f.key] ?? ''}
                placeholder={f.getDefault() || '(same-origin)'}
                onChange={(e) => change(f.key, (e.target as HTMLInputElement).value)}
                spellCheck={false}
                className="input settings-dev-input"
              />
            </label>
          ))}
          <button onClick={reset} className="settings-dev-reset">
            {t('settings.devReset')}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
