import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import type { Gender } from '@/lib/vault';
import { PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Field } from '@/components/molecules/onboarding';
import { EMAIL_RE } from '@/constants/validation';
import { ageFromBirthdate } from '@/lib/greeting';
import '@/styles/screens/main/edit-profile.css';

/* --------------------------- EDIT PROFILE ---------------------------- */
/** Edit the wallet's profile fields: name, email, gender. The birthdate is shown
 *  read-only — the app's age gates (13+, fiat 18+) must stay trustworthy. */
export function EditProfile({ store }: { store: WalletStore }) {
  const t = store.t;
  const [name, setName] = useState(store.meta?.name ?? '');
  const [email, setEmail] = useState(store.meta?.email ?? '');
  const [gender, setGender] = useState<Gender>(store.meta?.gender ?? 'x');
  const [busy, setBusy] = useState(false);
  const emailOk = EMAIL_RE.test(email.trim());
  const ok = name.trim().length >= 2 && emailOk && !busy;
  const birthdate = store.meta?.birthdate ?? '';
  const age = ageFromBirthdate(birthdate);

  const save = async () => {
    setBusy(true);
    try {
      await store.saveProfile({ name, email, gender });
      store.back('profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr screen col">
      <BackBar title={t('editProfile.title')} onBack={() => store.back('profile')} />
      <Field label={t('setup.nameLabel')} value={name} onChange={(v) => setName(v.slice(0, 24))} placeholder="p. ej. Alex" />
      <Field label={t('setup.emailLabel')} value={email} type="email" onChange={(v) => setEmail(v.trim().slice(0, 80))} placeholder="tu@correo.com" />
      {email.length > 0 && !emailOk && <div className="edit-profile-err">{t('setup.emailInvalid')}</div>}

      <div className="label-up edit-profile-label">{t('setup.genderLabel')}</div>
      <div className="row g8 edit-profile-genders">
        {(['m', 'f', 'x'] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGender(g)}
            className={gender === g ? 'edit-profile-gender edit-profile-gender-on' : 'glass-soft edit-profile-gender edit-profile-gender-off'}
          >
            {t(g === 'm' ? 'setup.genderM' : g === 'f' ? 'setup.genderF' : 'setup.genderX')}
          </button>
        ))}
      </div>

      {/* Birthdate: read-only. */}
      <div className="label-up edit-profile-label">{t('setup.dobLabel')}</div>
      <div className="glass edit-profile-dob">{birthdate || '—'}{age !== null ? ` · ${age} ${t('profile.years')}` : ''}</div>
      <div className="edit-profile-dob-note">{t('editProfile.dobLocked')}</div>

      <div className="ob-spacer" />
      <PrimaryButton disabled={!ok} onClick={save}>{busy ? <Spinner /> : t('common.save')}</PrimaryButton>
    </div>
  );
}
