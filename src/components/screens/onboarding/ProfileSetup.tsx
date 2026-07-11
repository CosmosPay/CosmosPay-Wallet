import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { ageFromBirthdate } from '@/lib/greeting';
import { EMAIL_RE } from '@/constants/validation';
import { Field, CheckRow } from '@/components/molecules/onboarding';
import '@/styles/screens/onboarding/profile-setup.css';

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
      <div className="profile-setup-emoji">👋</div>
      <div className="profile-setup-title">{t('setup.title')}</div>
      <div className="profile-setup-sub">{t('setup.subtitle')}</div>

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
        <div className="profile-setup-err">{t('setup.emailInvalid')}</div>
      )}
      <label className="ob-field">
        <div className="label-up ob-field-label">{t('setup.dobLabel')}</div>
        <input
          type="date"
          value={store.draftBirthdate}
          max={todayIso}
          onChange={(e) => store.setDraftBirthdate((e.target as HTMLInputElement).value)}
          className="input"
        />
      </label>
      {dobFuture && (
        <div className="profile-setup-err">{t('setup.dobFuture')}</div>
      )}
      {tooYoung && (
        <div className="profile-setup-err">{t('setup.tooYoung')}</div>
      )}

      {/* Gender: drives gendered copy ("bienvenido/bienvenida/bienvenidx") so the
          app never misgenders anyone. 'x' = non-binary / prefer not to say. */}
      <div className="label-up ob-field-label">{t('setup.genderLabel')}</div>
      <div className="row g8 profile-setup-genders">
        {(['m', 'f', 'x'] as const).map((g) => {
          const on = store.draftGender === g;
          return (
            <button
              key={g}
              onClick={() => store.setDraftGender(g)}
              className={on ? 'profile-setup-gender profile-setup-gender-on' : 'glass-soft profile-setup-gender profile-setup-gender-off'}
            >
              {t(g === 'm' ? 'setup.genderM' : g === 'f' ? 'setup.genderF' : 'setup.genderX')}
            </button>
          );
        })}
      </div>

      {/* Optional consents — both default OFF and never block the flow. */}
      <CheckRow on={store.draftMetricsOptIn} onToggle={() => store.setDraftMetricsOptIn(!store.draftMetricsOptIn)} className="profile-setup-check-metrics">
        {t('setup.metricsOptIn')}
      </CheckRow>
      <CheckRow on={store.draftPromoOptIn} onToggle={() => store.setDraftPromoOptIn(!store.draftPromoOptIn)} className="profile-setup-check-promo">
        {t('setup.promoOptIn')}
      </CheckRow>

      <div className="ob-spacer" />
      <PrimaryButton
        disabled={!ok || store.busy}
        onClick={() => (store.addingWallet ? store.finishOnboarding() : store.setScreen('password'))}
      >
        {store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
