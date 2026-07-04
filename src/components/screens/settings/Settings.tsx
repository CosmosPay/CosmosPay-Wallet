import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';
import { LangFlag } from '@/components/flags';
import { copyText } from '@/lib/clipboard';
import { shortAddr } from '@/lib/format';
import { changePassword } from '@/lib/vault';
import { LANGUAGES } from '@/lib/i18n';
import { ENDPOINT_FIELDS, devModeEnabled, setDevMode, getOverrides, setOverride, resetOverrides, type EndpointOverrides } from '@/lib/endpoints';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const copy = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('settings.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />

      <Section title={t('settings.appearance')}>
        <div className="flexr g8">
          {([['dark', t('settings.dark'), '🌙'], ['light', t('settings.light'), '☀️']] as const).map(([th, label, icon]) => {
            const on = store.theme === th;
            return (
              <button key={th} onClick={() => store.setTheme(th)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : 'var(--text)', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                <span>{icon}</span>{label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t('settings.language')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {LANGUAGES.map((l) => {
            const on = store.lang === l.code;
            return (
              <button key={l.code} onClick={() => store.setLang(l.code)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : 'var(--text)', border: 'none', borderRadius: '999px', padding: '9px 16px 9px 11px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>
                <LangFlag code={l.code} size={20} />{l.name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t('settings.myAddress')}>
        <div onClick={copy} className="tap glass" style={{ borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(pub, 10, 10)}</span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: copied ? C.accent : C.muted }}>{copied ? t('common.copied') : t('common.copy')}</span>
        </div>
      </Section>

      <Section title={t('settings.security')}>
        <ToggleRow label={t('settings.confirmSigns')} desc={t('settings.confirmSignsDesc')} on={store.requireConfirm} onChange={() => store.toggleConfirm()} />
        <Row label={t('settings.exportPhrase')} onClick={() => store.setScreen('export')} />
        <Row label={pwOpen ? t('settings.cancelChangePwd') : t('settings.changePwd')} onClick={() => setPwOpen((o) => !o)} last={!pwOpen} />
        {pwOpen && <ChangePassword store={store} onDone={() => setPwOpen(false)} />}
      </Section>

      <DevModeSection store={store} />

      <Section title={t('settings.danger')}>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ width: '100%', background: 'rgba(255,93,93,.10)', color: C.danger, border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            {t('settings.deleteThis')}
          </button>
        ) : (
          <div style={{ background: 'rgba(255,93,93,.08)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '16px', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>
              {t('settings.deleteConfirm', { name: store.meta?.name ?? '' })}
            </div>
            <div className="flexr g10">
              <button onClick={() => setConfirmDelete(false)} className="glass-soft" style={{ flex: 1, color: 'var(--text)', border: 'none', borderRadius: '12px', padding: '13px', fontWeight: 800, cursor: 'pointer' }}>{t('common.cancel')}</button>
              <button onClick={() => store.removeActiveWallet()} style={{ flex: 1, background: C.danger, color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontWeight: 800, cursor: 'pointer' }}>{t('common.delete')}</button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function ChangePassword({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = cur.length > 0 && next.length >= 8 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await changePassword(cur, next);
      store.flash(t('settings.pwdUpdated'), 'ok');
      onDone();
    } catch (e) {
      store.flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <Field label={t('settings.currentPwd')} value={cur} onChange={setCur} type="password" placeholder={t('settings.currentPwd')} />
      <Field label={t('settings.newPwd')} value={next} onChange={setNext} type="password" placeholder={t('pwd.min')} />
      <PrimaryButton disabled={!ok} onClick={submit}>{busy ? <Spinner /> : t('settings.savePwd')}</PrimaryButton>
    </div>
  );
}

/** Developer mode: live-overridable endpoints (prices API, Developer Platform,
 *  payments gateway). Persisted in localStorage; getters in lib/endpoints resolve
 *  per request, so changes apply immediately. Empty field = default value. */
function DevModeSection({ store }: { store: WalletStore }) {
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
    <Section title={t('settings.devMode')}>
      <div onClick={toggle} className="tap glass" style={{ borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span style={{ fontSize: '14px', fontWeight: 800 }}>{t('settings.devMode')}</span>
        <div style={{ width: '44px', height: '26px', borderRadius: '999px', background: on ? C.accent : 'var(--surface)', border: '1px solid var(--glass-border)', position: 'relative', transition: 'background .2s ease', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: '2px', left: on ? '20px' : '2px', width: '20px', height: '20px', borderRadius: '50%', background: on ? 'var(--on-accent)' : 'var(--text)', opacity: on ? 1 : 0.5, transition: 'left .2s ease' }} />
        </div>
      </div>

      {on && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '0 2px 12px' }}>{t('settings.devModeDesc')}</div>
          {ENDPOINT_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'block', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t(f.labelKey)}</div>
              <input
                value={vals[f.key] ?? ''}
                placeholder={f.getDefault() || '(same-origin)'}
                onChange={(e) => change(f.key, (e.target as HTMLInputElement).value)}
                spellCheck={false}
                className="input" style={{ height: '46px', fontSize: '13px', fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 600 }}
              />
            </label>
          ))}
          <button onClick={reset} style={{ width: '100%', background: C.cardSolid, color: 'var(--text)', border: '1px solid var(--glass-border)', borderRadius: '999px', padding: '13px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>
            {t('settings.devReset')}
          </button>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ marginTop: '22px' }}>
      <div className="label-up" style={{ marginBottom: '10px' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <div onClick={onClick} className="tap glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '14px', padding: '15px 16px', cursor: 'pointer', marginBottom: last ? 0 : '10px' }}>
      <span style={{ fontSize: '15px', fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
    </div>
  );
}

function ToggleRow({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: '12px', borderRadius: '14px', padding: '15px 16px', marginBottom: '10px' }}>
      <div className="f1 min0">
        <div style={{ fontSize: '15px', fontWeight: 700 }}>{label}</div>
        {desc && <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, lineHeight: 1.4, marginTop: '2px' }}>{desc}</div>}
      </div>
      <div onClick={() => onChange(!on)} className="tap" style={{ flexShrink: 0, width: '46px', height: '28px', borderRadius: '999px', background: on ? C.accent : 'var(--surface)', border: '1px solid var(--glass-border)', position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
        <div style={{ position: 'absolute', top: '2px', left: on ? '20px' : '2px', width: '22px', height: '22px', borderRadius: '50%', background: on ? 'var(--on-accent)' : 'var(--text)', transition: 'left .2s' }} />
      </div>
    </div>
  );
}
