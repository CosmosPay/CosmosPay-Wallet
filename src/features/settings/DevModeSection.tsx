import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { ENDPOINT_FIELDS, devModeEnabled, setDevMode, getOverrides, setOverride, resetOverrides, type EndpointOverrides } from '@/lib/endpoints';
import { ToggleRow } from '@/features/settings/ToggleRow';
import { GhostButton } from '@/ui/Buttons';
import '@/styles/features/settings/settings.css';

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
      <ToggleRow label={t('settings.devMode')} on={on} onChange={toggle} />

      {on && (
        <div className="settings-subform">
          <div className="settings-dev-desc">{t('settings.devModeDesc')}</div>
          {ENDPOINT_FIELDS.map((f) => (
            <label key={f.key} className="settings-dev-field">
              <span className="field-label">{t(f.labelKey)}</span>
              <input
                value={vals[f.key] ?? ''}
                placeholder={f.getDefault() || '(same-origin)'}
                onChange={(e) => change(f.key, (e.target as HTMLInputElement).value)}
                spellCheck={false}
                className="input settings-dev-input"
              />
            </label>
          ))}
          <GhostButton onClick={reset}>{t('settings.devReset')}</GhostButton>
        </div>
      )}
    </SettingsSection>
  );
}
