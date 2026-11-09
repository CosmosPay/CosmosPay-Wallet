import { useId, useState } from 'react';
import type { WalletStore } from '@/state/store';
import type { Gender } from '@/lib/vault';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { InfoCircleIcon, LockIcon } from '@/ui/Icons';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { EMAIL_RE } from '@/lib/validate';
import { GENDER_OPTIONS, NAME_MAX_LEN, EMAIL_MAX_LEN } from '@/constants/onboarding';
import { ageFromBirthdate } from '@/lib/greeting';
import '@/styles/features/wallet/edit-profile.css';

/** Profile details; birthdate remains read-only because age gates depend on it. */
export function EditProfile({ store }: { store: WalletStore }) {
  const t = store.t;
  const id = useId();
  const [name, setName] = useState(store.meta?.name ?? '');
  const [email, setEmail] = useState(store.meta?.email ?? '');
  const [gender, setGender] = useState<Gender>(store.meta?.gender ?? 'x');
  const [busy, run] = useBusy();
  const emailOk = EMAIL_RE.test(email.trim());
  const emailError = email.length > 0 && !emailOk;
  const ok = name.trim().length >= 2 && emailOk && !busy;
  const birthdate = store.meta?.birthdate ?? '';
  const age = ageFromBirthdate(birthdate);

  const save = () => {
    if (!ok) return;
    return run(async () => {
      await store.saveProfile({ name, email, gender });
      store.goBack();
    });
  };

  return (
    <form className="scr screen col edit-profile" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <ScreenHeader title={t('editProfile.title')} onBack={store.goBack} />
      <div className="edit-profile-fields">
        <label className="edit-profile-field">
          <span>{t('setup.nameLabel')}</span>
          <input className="input" value={name} autoComplete="nickname" required minLength={2} maxLength={NAME_MAX_LEN}
            onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="edit-profile-field">
          <label htmlFor={`${id}-email`}>{t('setup.emailLabel')}</label>
          <input id={`${id}-email`} className="input" value={email} type="email" autoComplete="email" required
            maxLength={EMAIL_MAX_LEN} spellCheck={false} autoCapitalize="none"
            aria-invalid={emailError} aria-describedby={emailError ? `${id}-email-error` : undefined}
            onChange={(event) => setEmail(event.target.value.trim())} />
          {emailError && <p id={`${id}-email-error`} className="edit-profile-err" role="status">{t('setup.emailInvalid')}</p>}
        </div>
        <fieldset className="edit-profile-genders">
          <legend>{t('setup.genderLabel')}</legend>
          <div className="edit-profile-gender-options">
            {GENDER_OPTIONS.map((option) => (
              <label key={option.id} className="edit-profile-gender">
                <input className="sr-only" type="radio" name={`${id}-gender`} value={option.id}
                  checked={gender === option.id} onChange={() => setGender(option.id)} />
                <span>{t(option.labelKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="edit-profile-field">
          <label htmlFor={`${id}-birthdate`}>{t('setup.dobLabel')}</label>
          <div className="edit-profile-dob">
            <input id={`${id}-birthdate`} className="input" readOnly value={birthdate || '—'} aria-describedby={`${id}-birthdate-note`} />
            <LockIcon />
          </div>
          <p id={`${id}-birthdate-note`} className="edit-profile-dob-note">
            <InfoCircleIcon />
            <span>{t('editProfile.dobLocked')}{age !== null && <span className="edit-profile-age">{age} {t('profile.years')}</span>}</span>
          </p>
        </div>
      </div>
      <div className="spacer" />
      <div className="kb-dock edit-profile-actions">
        <button type="submit" className="btn-primary ink" disabled={!ok} aria-busy={busy}>
          {busy && <Spinner />}{t('common.save')}
        </button>
      </div>
    </form>
  );
}
