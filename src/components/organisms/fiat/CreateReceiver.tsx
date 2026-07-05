import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Field, Select } from '@/components/molecules/fiat';
import { PhotoStep } from './PhotoStep';
import { COUNTRIES, DOC_TYPES } from '@/constants/fiat';
import '@/styles/screens/fiat/fiat.css';

/** KYC wizard: personal info → doc front → doc back → selfie, then create the receiver. */
export function CreateReceiver({ store }: { store: WalletStore }) {
  const t = store.t;
  const [step, setStep] = useState(0); // 0 info · 1 front · 2 back · 3 selfie
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(store.meta?.email ?? '');
  const [country, setCountry] = useState('BR');
  const [docType, setDocType] = useState('ID_CARD');
  const [dob, setDob] = useState('');
  const [taxId, setTaxId] = useState('');
  const [addr, setAddr] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postal, setPostal] = useState('');
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);

  const infoOk = firstName.trim() && lastName.trim() && email.trim() && country && taxId.trim() && dob;

  const submit = async () => {
    await store.createFiatReceiver({
      email: email.trim(),
      country,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dob ? new Date(dob).toISOString() : undefined,
      tax_id: taxId.trim() || undefined,
      address_line_1: addr.trim() || undefined,
      city: city.trim() || undefined,
      state_province_region: region.trim() || undefined,
      postal_code: postal.trim() || undefined,
      id_doc_country: country,
      id_doc_type: docType,
      id_doc_front_file: front ?? undefined,
      id_doc_back_file: back ?? undefined,
      selfie_file: selfie ?? undefined,
    });
  };

  const back1 = () => (step === 0 ? store.go('home', 'home') : setStep(step - 1));

  return (
    <>
      <BackBar title={`${t('fiat.kycTitle')} · ${step + 1}/4`} onBack={back1} />
      {/* progress dots */}
      <div className="flexr g6 fiat-progress">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={i <= step ? 'fiat-progress-dot is-active' : 'fiat-progress-dot'} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="fiat-desc fiat-kyc-desc">{t('fiat.createDesc')}</div>
          <div className="flexr g10">
            <div className="f1"><Field label={t('fiat.firstName')} value={firstName} onChange={setFirstName} /></div>
            <div className="f1"><Field label={t('fiat.lastName')} value={lastName} onChange={setLastName} /></div>
          </div>
          <Field label={t('fiat.email')} value={email} onChange={setEmail} type="email" />
          <div className="flexr g10">
            <Select label={t('fiat.country')} value={country} onChange={setCountry} style={{ flex: 1 }}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
            <Select label={t('fiat.docType')} value={docType} onChange={setDocType} style={{ flex: 1 }}>
              {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`fiat.doc.${d}`)}</option>)}
            </Select>
          </div>
          <Field label={t('fiat.taxId')} value={taxId} onChange={setTaxId} placeholder={t('fiat.taxIdPlaceholder')} />
          <Field label={t('fiat.dob')} value={dob} onChange={setDob} type="date" />
          <Field label={t('fiat.address')} value={addr} onChange={setAddr} />
          <div className="flexr g10">
            <div className="fiat-flex-14"><Field label={t('fiat.city')} value={city} onChange={setCity} /></div>
            <div className="f1"><Field label={t('fiat.region')} value={region} onChange={setRegion} /></div>
            <div className="f1"><Field label={t('fiat.postal')} value={postal} onChange={setPostal} /></div>
          </div>
          <div className="fiat-gap-6" />
          <PrimaryButton disabled={!infoOk} onClick={() => setStep(1)}>{t('common.continue')}</PrimaryButton>
        </>
      )}

      {step === 1 && <PhotoStep store={store} capture="environment" title={t('fiat.docFront')} hint={t('fiat.docFrontHint')} fileUrl={front} onUploaded={setFront} />}
      {step === 2 && <PhotoStep store={store} capture="environment" title={t('fiat.docBack')} hint={t('fiat.docBackHint')} fileUrl={back} onUploaded={setBack} />}
      {step === 3 && <PhotoStep store={store} capture="user" title={t('fiat.selfie')} hint={t('fiat.selfieHint')} fileUrl={selfie} onUploaded={setSelfie} />}

      {step > 0 && (
        <>
          <div className="fiat-spacer-16" />
          {step < 3 ? (
            <PrimaryButton disabled={step === 1 ? !front : !back} onClick={() => setStep(step + 1)}>{t('common.continue')}</PrimaryButton>
          ) : (
            <PrimaryButton disabled={!selfie || store.busy} onClick={submit}>{store.busy ? <Spinner /> : t('fiat.create')}</PrimaryButton>
          )}
          <div className="fiat-kyc-note">{t('fiat.kycNote')}</div>
        </>
      )}
    </>
  );
}
