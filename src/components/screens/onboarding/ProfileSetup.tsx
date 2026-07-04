import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { ageFromBirthdate } from '@/lib/greeting';
import { EMAIL_RE } from '@/constants/validation';
import { Field, CheckRow } from './shared';

export function ProfileSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const name = store.draftName;
  const email = store.draftEmail;
  const emailOk = EMAIL_RE.test(email.trim());
  // Local-timezone today in ISO — the birthdate can never be in the future.
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dobFuture = !!store.draftBirthdate && store.draftBirthdate > todayIso;
  // Minimum age to use the app: 13 (fiat has its own 18+ gate later).
  const tooYoung = !!store.draftBirthdate && !dobFuture && (ageFromBirthdate(store.draftBirthdate) ?? 0) < 13;
  // Name, email, a valid 13+ birthdate and a gender pick are all required.
  const ok = name.trim().length >= 2 && emailOk && !!store.draftBirthdate && !dobFuture && !tooYoung && !!store.draftGender;
  const back = () =>
    store.setScreen(store.draftHasMnemonic && store.draftMnemonic ? 'verify' : 'import');

  return (
    <div className="scr screen col">
      <BackBar title={t('setup.about')} onBack={back} />
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 6px', fontSize: '50px', lineHeight: 1 }}>👋</div>
      <div style={{ fontSize: '22px', fontWeight: 800, textAlign: 'center', letterSpacing: '-.5px', marginBottom: '8px' }}>{t('setup.title')}</div>
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, textAlign: 'center', margin: '0 6px 22px' }}>
        {t('setup.subtitle')}
      </div>

      <Field
        label={t('setup.nameLabel')}
        value={name}
        onChange={(v) => store.setDraftName(v.slice(0, 24))}
        placeholder="p. ej. Alex"
      />
      <Field
        label={t('setup.emailLabel')}
        value={email}
        type="email"
        onChange={(v) => store.setDraftEmail(v.trim().slice(0, 80))}
        placeholder="tu@correo.com"
      />
      {email.length > 0 && !emailOk && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.emailInvalid')}</div>
      )}
      <label style={{ display: 'block', marginBottom: '14px' }}>
        <div className="label-up" style={{ marginBottom: '7px' }}>{t('setup.dobLabel')}</div>
        <input
          type="date"
          value={store.draftBirthdate}
          max={todayIso}
          onChange={(e) => store.setDraftBirthdate((e.target as HTMLInputElement).value)}
          className="input" style={{ colorScheme: store.theme === 'light' ? 'light' : 'dark' }}
        />
      </label>
      {dobFuture && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.dobFuture')}</div>
      )}
      {tooYoung && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: C.danger, margin: '-8px 2px 12px' }}>{t('setup.tooYoung')}</div>
      )}

      {/* Gender: drives gendered copy ("bienvenido/bienvenida/bienvenidx") so the
          app never misgenders anyone. 'x' = non-binary / prefer not to say. */}
      <div className="label-up" style={{ marginBottom: '7px' }}>{t('setup.genderLabel')}</div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        {(['m', 'f', 'x'] as const).map((g) => {
          const on = store.draftGender === g;
          return (
            <button
              key={g}
              onClick={() => store.setDraftGender(g)}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '999px',
                fontSize: '12.5px',
                fontWeight: 800,
                cursor: 'pointer',
                ...(on
                  ? { background: 'var(--primary-bg)', color: 'var(--primary-text)', border: '1px solid var(--primary-border)' }
                  : { ...C.glassSoft, color: 'var(--text)' }),
              }}
            >
              {t(g === 'm' ? 'setup.genderM' : g === 'f' ? 'setup.genderF' : 'setup.genderX')}
            </button>
          );
        })}
      </div>

      {/* Optional consents — both default OFF and never block the flow. */}
      <CheckRow on={store.draftMetricsOptIn} onToggle={() => store.setDraftMetricsOptIn(!store.draftMetricsOptIn)} style={{ marginBottom: '10px' }}>
        {t('setup.metricsOptIn')}
      </CheckRow>
      <CheckRow on={store.draftPromoOptIn} onToggle={() => store.setDraftPromoOptIn(!store.draftPromoOptIn)} style={{ marginBottom: '14px' }}>
        {t('setup.promoOptIn')}
      </CheckRow>

      <div style={{ flex: 1, minHeight: '14px' }} />
      <PrimaryButton
        disabled={!ok || store.busy}
        onClick={() => (store.addingWallet ? store.finishOnboarding() : store.setScreen('password'))}
      >
        {store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
