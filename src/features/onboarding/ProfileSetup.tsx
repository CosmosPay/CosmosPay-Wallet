import { useEffect, useState, type FormEvent } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { ageFromBirthdate } from '@/lib/greeting';
import { EMAIL_RE, isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { GhostButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { GENDER_OPTIONS, MIN_AGE, NAME_MAX_LEN, EMAIL_MAX_LEN, PROFILE_STEPS, type ProfileStep } from '@/constants/onboarding';
import { OptionalConsents } from '@/features/onboarding/OptionalConsents';
import { Field } from '@/ui/Field';
import { cx } from '@/lib/cx';
import '@/styles/ui/field.css';
import '@/styles/features/onboarding/profile-setup.css';

/**
 * About you, one question per step (the user's call: one screen with every field was too
 * much at once) — the name, the email and the code that proves it (the wallet's Cosmos Wallet
 * account), the age and gender, then the two optional consents.
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

  // The account step (the user's call: the wallet comes with its Cosmos Wallet account). The
  // email is proven by a code; a server that does not answer lets the person go on and create
  // the account later from Home — a wallet never waits on the server.
  const cleanEmail = email.trim().toLowerCase();
  const proven = store.profileEmailProvenFor === cleanEmail;
  const [skipAccount, setSkipAccount] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);

  const answered: Record<ProfileStep, boolean> = {
    name: nameOk,
    email: emailOk,
    code: proven || skipAccount || store.addingWallet,
    about: aboutOk,
    optional: true,
  };
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
  const sendCode = async () => {
    setSending(true);
    try {
      const sent = await store.sendProfileEmailCode(cleanEmail);
      setUnavailable(sent === 'unavailable');
      if (sent === 'sent') {
        setCode('');
        store.goStep('code');
      }
    } finally {
      setSending(false);
    }
  };
  const next = async () => {
    if (store.busy || sending) return;
    // The email step sends the code (or, already proven, goes past it).
    if (step === 'email') {
      if (!emailOk) return;
      if (proven || store.addingWallet) return store.goStep('about');
      return void sendCode();
    }
    if (step === 'code' && !answered.code) {
      if (!isAccessCode(code)) return;
      setSending(true);
      try {
        if (await store.verifyProfileEmailCode(code)) store.goStep('about');
      } finally {
        setSending(false);
      }
      return;
    }
    if (!answered[step]) return;
    if (!last) return store.goStep(PROFILE_STEPS[at + 1]);
    if (store.addingWallet) void store.finishOnboarding();
    else store.setScreen('password');
  };
  // Enter in the step's field goes on, like the button.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void next();
  };

  const header = {
    name: { title: t('setup.title'), desc: t('setup.nameDesc') },
    email: { title: t('setup.emailTitle'), desc: t('setup.emailDesc') },
    code: { title: t('setup.codeTitle'), desc: t('setup.codeDesc', { email: cleanEmail }) },
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
          {unavailable && (
            <Notice className="profile-setup-note">
              {t('setup.accountUnavailable')}
              <GhostButton
                onClick={() => {
                  setSkipAccount(true);
                  setUnavailable(false);
                  store.goStep('about');
                }}
                className="profile-setup-skip"
              >
                {t('setup.skipAccount')}
              </GhostButton>
            </Notice>
          )}
        </>
      )}

      {step === 'code' && (
        <>
          {skipAccount && !proven ? (
            <Notice className="profile-setup-note">{t('setup.accountLater')}</Notice>
          ) : proven ? (
            <Notice className="profile-setup-note">{t('setup.emailProven', { email: cleanEmail })}</Notice>
          ) : (
            <>
              <label className="field">
                <span className="field-label">{t('setup.codeLabel')}</span>
                <input
                  value={code}
                  onChange={(e) => setCode(normalizeAccessCode((e.target as HTMLInputElement).value))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input profile-setup-code"
                />
              </label>
              <button type="button" onClick={() => void sendCode()} disabled={sending} className="link-btn profile-setup-resend">
                {t('setup.resend')}
              </button>
            </>
          )}
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
        <PrimaryButton
          disabled={store.busy || sending || (step === 'code' && !answered.code ? !isAccessCode(code) : !answered[step])}
          onClick={() => void next()}
        >
          {sending || (last && store.busy) ? <Spinner /> : last && store.addingWallet ? t('setup.addWallet') : t('common.continue')}
        </PrimaryButton>
      </div>
    </form>
  );
}
