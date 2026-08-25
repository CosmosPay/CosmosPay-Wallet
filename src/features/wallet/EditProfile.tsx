import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import type { Gender } from '@/lib/vault';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { EMAIL_RE } from '@/lib/validate';
import { GENDER_OPTIONS, NAME_MAX_LEN, EMAIL_MAX_LEN } from '@/constants/onboarding';
import { ageFromBirthdate } from '@/lib/greeting';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/edit-profile.css';

/* --------------------------- EDIT PROFILE ---------------------------- */
/** Edit the wallet's profile fields: name, email, gender. The birthdate is shown
 *  read-only — the app's age gates (13+, fiat 18+) must stay trustworthy. */
export function EditProfile({ store }: { store: WalletStore }) {
  const t = store.t;
  const [name, setName] = useState(store.meta?.name ?? '');
  const [email, setEmail] = useState(store.meta?.email ?? '');
  const [gender, setGender] = useState<Gender>(store.meta?.gender ?? 'x');
  const [busy, run] = useBusy();
  const emailOk = EMAIL_RE.test(email.trim());
  const ok = name.trim().length >= 2 && emailOk && !busy;
  const birthdate = store.meta?.birthdate ?? '';
  const age = ageFromBirthdate(birthdate);

  const save = () =>
    run(async () => {
      await store.saveProfile({ name, email, gender });
      store.goBack();
    });

  return (
    <div className="scr screen col">
      <BackBar title={t('editProfile.title')} onBack={store.goBack} />
      <Field label={t('setup.nameLabel')} value={name} onChange={(v) => setName(v.slice(0, NAME_MAX_LEN))} placeholder="p. ej. Alex" />
      <Field label={t('setup.emailLabel')} value={email} type="email" onChange={(v) => setEmail(v.trim().slice(0, EMAIL_MAX_LEN))} placeholder="tu@correo.com" />
      {email.length > 0 && !emailOk && <div className="edit-profile-err">{t('setup.emailInvalid')}</div>}

      <div className="label-up edit-profile-label">{t('setup.genderLabel')}</div>
      <div className="row g8 edit-profile-genders">
        {GENDER_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => setGender(o.id)}
            className={cx('edit-profile-gender', gender === o.id ? 'edit-profile-gender-on' : 'glass-soft edit-profile-gender-off')}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>

      {/* Birthdate: read-only. */}
      <div className="label-up edit-profile-label">{t('setup.dobLabel')}</div>
      <div className="glass edit-profile-dob">{birthdate || '—'}{age !== null ? ` · ${age} ${t('profile.years')}` : ''}</div>
      <div className="edit-profile-dob-note">{t('editProfile.dobLocked')}</div>

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ok} onClick={save}>{busy ? <Spinner /> : t('common.save')}</PrimaryButton>
      </div>
    </div>
  );
}
