import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { ageFromBirthdate } from '@/lib/greeting';
import { EMAIL_RE } from '@/lib/validate';
import { GENDER_OPTIONS, MIN_AGE, NAME_MAX_LEN, EMAIL_MAX_LEN } from '@/constants/onboarding';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { Field } from '@/ui/Field';
import { cx } from '@/lib/cx';
import '@/styles/ui/field.css';
import '@/styles/features/onboarding/profile-setup.css';

export function ProfileSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const name = store.draftName;
  const email = store.draftEmail;
  const emailOk = EMAIL_RE.test(email.trim());
  // Local-timezone today in ISO — the birthdate can never be in the future.
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dobFuture = !!store.draftBirthdate && store.draftBirthdate > todayIso;
  // Minimum age to use the app: MIN_AGE (fiat has its own 18+ gate later).
  const tooYoung = !!store.draftBirthdate && !dobFuture && (ageFromBirthdate(store.draftBirthdate) ?? 0) < MIN_AGE;
  // Name, email, a valid 13+ birthdate and a gender pick are all required.
  const ok = name.trim().length >= 2 && emailOk && !!store.draftBirthdate && !dobFuture && !tooYoung && !!store.draftGender;

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('setup.title')} desc={t('setup.subtitle')} onBack={store.goBack} />

      <Field
        label={t('setup.nameLabel')}
        value={name}
        onChange={(v) => store.setDraftName(v.slice(0, NAME_MAX_LEN))}
        placeholder="p. ej. Alex"
      />
      <Field
        label={t('setup.emailLabel')}
        value={email}
        type="email"
        onChange={(v) => store.setDraftEmail(v.trim().slice(0, EMAIL_MAX_LEN))}
        placeholder="tu@correo.com"
      />
      {email.length > 0 && !emailOk && (
        <div className="err-line profile-setup-err">{t('setup.emailInvalid')}</div>
      )}
      <label className="field">
        <div className="field-label">{t('setup.dobLabel')}</div>
        <input
          type="date"
          value={store.draftBirthdate}
          max={todayIso}
          onChange={(e) => store.setDraftBirthdate((e.target as HTMLInputElement).value)}
          className="input"
        />
      </label>
      {dobFuture && (
        <div className="err-line profile-setup-err">{t('setup.dobFuture')}</div>
      )}
      {tooYoung && (
        <div className="err-line profile-setup-err">{t('setup.tooYoung')}</div>
      )}

      <div className="field-label" id="profile-setup-gender">{t('setup.genderLabel')}</div>
      <div className="row g8 profile-setup-genders" role="group" aria-labelledby="profile-setup-gender">
        {GENDER_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={store.draftGender === o.id}
            onClick={() => store.setDraftGender(o.id)}
            className={cx('profile-setup-gender', store.draftGender === o.id && 'is-on')}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>

      {/* Optional consents — both default OFF and never block the flow. Shared with the
          social path, which asks for the same two after its password step. */}
      <OptionalConsents store={store} />

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton
          disabled={!ok || store.busy}
          onClick={() => (store.addingWallet ? store.finishOnboarding() : store.setScreen('password'))}
        >
          {store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
        </PrimaryButton>
      </div>
    </div>
  );
}
