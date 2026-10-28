import { useEffect, type FormEvent } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { ageFromBirthdate } from '@/lib/greeting';
import { EMAIL_RE } from '@/lib/validate';
import { GENDER_OPTIONS, MIN_AGE, NAME_MAX_LEN, EMAIL_MAX_LEN, PROFILE_STEPS, type ProfileStep } from '@/constants/onboarding';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { Field } from '@/ui/Field';
import { cx } from '@/lib/cx';
import '@/styles/ui/field.css';
import '@/styles/features/onboarding/profile-setup.css';

/**
 * About you, one question per step (the user's call: one screen with every field was too
 * much at once) — the name, the email, the age and gender, then the two optional consents.
 * The steps are stops on the navigation stack (`goStep`), so every back walks them, and what
 * was typed lives in the store's drafts, so nothing is lost on the way. A step is only shown
 * once the ones before it are answered: arriving further (forward, after leaving) lands on
 * the first one still open.
 */
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
  const nameOk = name.trim().length >= 2;
  const aboutOk = !!store.draftBirthdate && !dobFuture && !tooYoung && !!store.draftGender;

  const answered: Record<ProfileStep, boolean> = { name: nameOk, email: emailOk, about: aboutOk, optional: true };
  const wanted = Math.max(0, PROFILE_STEPS.indexOf(store.navStep as ProfileStep));
  let at = 0;
  while (at < wanted && answered[PROFILE_STEPS[at]]) at++;
  const step = PROFILE_STEPS[at];

  // Shown an earlier step than the path says: correct the path, without a new stop.
  const { replaceStep } = store;
  useEffect(() => {
    if (at < wanted) replaceStep(at === 0 ? undefined : PROFILE_STEPS[at]);
  }, [at, wanted, replaceStep]);

  const last = at === PROFILE_STEPS.length - 1;
  const next = () => {
    if (!answered[step] || store.busy) return;
    if (!last) return store.goStep(PROFILE_STEPS[at + 1]);
    if (store.addingWallet) void store.finishOnboarding();
    else store.setScreen('password');
  };
  // Enter in the step's field goes on, like the button.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    next();
  };

  const header = {
    name: { title: t('setup.title'), desc: t('setup.nameDesc') },
    email: { title: t('setup.emailTitle'), desc: t('setup.emailDesc') },
    about: { title: t('setup.about'), desc: t('setup.aboutDesc', { n: MIN_AGE }) },
    optional: { title: t('setup.optionalTitle'), desc: t('setup.optionalDesc') },
  }[step];

  return (
    <form className="scr screen col" onSubmit={submit} noValidate>
      <div className="profile-setup-progress">
        <div className="profile-setup-bars" aria-hidden="true">
          {PROFILE_STEPS.map((s, i) => (
            <span key={s} className={cx('profile-setup-bar', i <= at && 'is-done')} />
          ))}
        </div>
        <span className="profile-setup-count">{t('setup.step', { n: at + 1, total: PROFILE_STEPS.length })}</span>
      </div>
      <ScreenHeader title={header.title} desc={header.desc} onBack={store.goBack} />

      {step === 'name' && (
        <Field
          label={t('setup.nameLabel')}
          value={name}
          onChange={(v) => store.setDraftName(v.slice(0, NAME_MAX_LEN))}
          placeholder="p. ej. Alex"
        />
      )}

      {step === 'email' && (
        <>
          <Field
            label={t('setup.emailLabel')}
            value={email}
            type="email"
            onChange={(v) => store.setDraftEmail(v.trim().slice(0, EMAIL_MAX_LEN))}
            placeholder="tu@correo.com"
          />
          {email.length > 0 && !emailOk && <div className="err-line profile-setup-err">{t('setup.emailInvalid')}</div>}
        </>
      )}

      {step === 'about' && (
        <>
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
          {dobFuture && <div className="err-line profile-setup-err">{t('setup.dobFuture')}</div>}
          {tooYoung && <div className="err-line profile-setup-err">{t('setup.tooYoung')}</div>}

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
        </>
      )}

      {/* Optional consents — both default OFF and never block the flow. Shared with the
          sign-in path, which asks for the same two after its password step. */}
      {step === 'optional' && <OptionalConsents store={store} />}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!answered[step] || store.busy} onClick={next}>
          {last && store.addingWallet ? (store.busy ? <Spinner /> : t('setup.addWallet')) : t('common.continue')}
        </PrimaryButton>
      </div>
    </form>
  );
}
