import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { ageFromBirthdate } from '@/lib/greeting';
import { COUNTRIES, DOC_TYPES, railLabel } from '@/constants/fiat';
import { Field, Select } from './shared';

/* BlindPay fiat (on/off-ramp). LatAm-first. Needs a `standard` KYC receiver (photo ID +
   selfie) kept as the wallet's default; once verified, the hub exposes deposit/withdraw. */


export function Fiat({ store }: { store: WalletStore }) {
  const receiverId = store.meta?.cosmosPayReceiverId;
  // 18+ only. The home entry card is already hidden for minors; this guard also
  // covers the other paths into this screen (CosmosPay manage-receiver, back nav…).
  const adult = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;

  useEffect(() => {
    if (adult) store.loadReceivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.meta?.id, store.network.id, adult]);

  if (!adult) {
    return (
      <div className="scr screen col pb-104">
        <BackBar title={store.t('fiat.tab')} onBack={() => store.go('home', 'home')} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', textAlign: 'center', color: C.muted, padding: '0 16px 50px' }}>
          <div style={{ fontSize: '40px', opacity: 0.6 }}>🔞</div>
          <div style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.6 }}>{store.t('fiat.adultOnly')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="scr screen col pb-104">
      {receiverId ? <ReceiverHub store={store} receiverId={receiverId} /> : <CreateReceiver store={store} />}
    </div>
  );
}

/* ---------------------------- KYC wizard ----------------------------- */

/** A single photo step: pick from camera/gallery, upload, show progress + result. */
function PhotoStep({ store, capture, title, hint, fileUrl, onUploaded }: { store: WalletStore; capture: 'environment' | 'user'; title: string; hint: string; fileUrl: string | null; onUploaded: (url: string) => void }) {
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    const url = await store.uploadKycDoc(file, 'onboarding');
    setUploading(false);
    if (url) onUploaded(url);
  };

  const done = !!fileUrl && !uploading;
  return (
    <>
      <div style={{ fontSize: '17px', fontWeight: 800, margin: '6px 2px 4px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '0 2px 16px' }}>{hint}</div>
      <div
        onClick={() => inputRef.current?.click()}
        className="tap"
        style={{ position: 'relative', borderRadius: '20px', overflow: 'hidden', border: `2px dashed ${done ? 'var(--up)' : 'var(--glass-border)'}`, aspectRatio: capture === 'user' ? '1 / 1' : '3 / 2', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.cardSolid, cursor: 'pointer' }}
      >
        {preview ? (
          <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: C.muted }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h5l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.7" /></svg>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>{store.t('fiat.takePhoto')}</span>
          </div>
        )}
        {uploading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}><Spinner color="#fff" /></div>
        )}
        {done && (
          <div style={{ position: 'absolute', top: '10px', right: '10px', width: '28px', height: '28px', borderRadius: '50%', background: 'var(--up)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✓</div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture={capture} onChange={pick} style={{ display: 'none' }} />
    </>
  );
}

function CreateReceiver({ store }: { store: WalletStore }) {
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
      <div style={{ display: 'flex', gap: '6px', margin: '2px 2px 16px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, height: '4px', borderRadius: '999px', background: i <= step ? C.accent : 'var(--glass-border)' }} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '0 2px 16px' }}>{t('fiat.createDesc')}</div>
          <div className="flexr g10">
            <div style={{ flex: 1 }}><Field label={t('fiat.firstName')} value={firstName} onChange={setFirstName} /></div>
            <div style={{ flex: 1 }}><Field label={t('fiat.lastName')} value={lastName} onChange={setLastName} /></div>
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
            <div style={{ flex: 1.4 }}><Field label={t('fiat.city')} value={city} onChange={setCity} /></div>
            <div style={{ flex: 1 }}><Field label={t('fiat.region')} value={region} onChange={setRegion} /></div>
            <div style={{ flex: 1 }}><Field label={t('fiat.postal')} value={postal} onChange={setPostal} /></div>
          </div>
          <div style={{ height: '6px' }} />
          <PrimaryButton disabled={!infoOk} onClick={() => setStep(1)}>{t('common.continue')}</PrimaryButton>
        </>
      )}

      {step === 1 && <PhotoStep store={store} capture="environment" title={t('fiat.docFront')} hint={t('fiat.docFrontHint')} fileUrl={front} onUploaded={setFront} />}
      {step === 2 && <PhotoStep store={store} capture="environment" title={t('fiat.docBack')} hint={t('fiat.docBackHint')} fileUrl={back} onUploaded={setBack} />}
      {step === 3 && <PhotoStep store={store} capture="user" title={t('fiat.selfie')} hint={t('fiat.selfieHint')} fileUrl={selfie} onUploaded={setSelfie} />}

      {step > 0 && (
        <>
          <div style={{ flex: 1, minHeight: '16px' }} />
          {step < 3 ? (
            <PrimaryButton disabled={step === 1 ? !front : !back} onClick={() => setStep(step + 1)}>{t('common.continue')}</PrimaryButton>
          ) : (
            <PrimaryButton disabled={!selfie || store.busy} onClick={submit}>{store.busy ? <Spinner /> : t('fiat.create')}</PrimaryButton>
          )}
          <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, textAlign: 'center', marginTop: '12px', lineHeight: 1.5 }}>{t('fiat.kycNote')}</div>
        </>
      )}
    </>
  );
}

/* ------------------------------- hub --------------------------------- */

/** Map BlindPay's raw KYC status (+ the `disabled` flag) to a friendly label + colour. */
function kycStatus(store: WalletStore, raw?: string | null, disabled?: boolean): { label: string; color: string; approved: boolean } {
  const s = (raw || 'pending').toLowerCase();
  // A receiver only counts as approved if it's verified AND not disabled.
  const approved = !disabled && /approv|verified|active|complete|success/.test(s);
  const rejected = disabled === true || /reject|denied|fail|declin/.test(s);
  return {
    label: approved ? store.t('fiat.statusApproved') : rejected ? store.t('fiat.statusRejected') : store.t('fiat.statusPending'),
    color: approved ? 'var(--up)' : rejected ? C.danger : C.muted,
    approved,
  };
}

/** Once a default receiver exists: KYC status + swap-style deposit/withdraw + deposit accounts. */
function ReceiverHub({ store, receiverId }: { store: WalletStore; receiverId: string }) {
  const t = store.t;
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // account id pending delete-confirm

  useEffect(() => {
    store.loadReceiver(receiverId); // refreshes the real KYC status from BlindPay
    store.loadBankAccounts(receiverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const receiver = store.receivers.find((r) => r.id === receiverId) ?? null;
  const st = kycStatus(store, receiver?.kycStatus ?? receiver?.kyc_status ?? receiver?.status, receiver?.disabled);

  const OpCard = ({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) => (
    <div onClick={onClick} className="tap glass" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px', borderRadius: '20px', cursor: 'pointer', marginBottom: '12px' }}>
      <div className="glass-soft" style={{ width: '46px', height: '46px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{icon}</svg>
      </div>
      <div className="f1 min0">
        <div style={{ fontSize: '15px', fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: '12.5px', color: C.muted, fontWeight: 600 }}>{desc}</div>
      </div>
      <span style={{ color: C.dim, fontSize: '20px' }}>›</span>
    </div>
  );

  return (
    <>
      <BackBar title={t('fiat.title')} onBack={() => store.go('home', 'home')} />
      <div className="glass card" style={{ marginBottom: '18px' }}>
        <div style={{ fontSize: '12px', color: C.muted, fontWeight: 700, marginBottom: '6px' }}>{t('fiat.account')}</div>
        <div className="row between">
          <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace' }}>{receiverId.slice(0, 10)}…</span>
          <span style={{ fontSize: '12px', fontWeight: 800, padding: '4px 10px', borderRadius: '999px', background: 'var(--surface)', color: st.color }}>{st.label}</span>
        </div>
      </div>
      <OpCard
        icon={<path d="M12 4v13M6 11l6 6 6-6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        title={t('fiat.onramp')} desc={t('fiat.onrampDesc')}
        onClick={() => (st.approved ? store.setScreen('deposit') : store.flash(t('fiat.needApproved'), 'info'))}
      />
      <OpCard
        icon={<path d="M12 4v13M6 10l6-6 6 6M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        title={t('fiat.offramp')} desc={t('fiat.offrampDesc')}
        onClick={() => (st.approved ? store.setScreen('withdraw') : store.flash(t('fiat.needApproved'), 'info'))}
      />

      {/* Deposit/payout accounts (per currency / rail). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 2px 10px' }}>
        <span style={{ fontSize: '15px', fontWeight: 800 }}>{t('fiat.accounts')}</span>
        <span onClick={() => store.setScreen('bankaccount')} style={{ fontSize: '13px', color: C.accent, fontWeight: 800, cursor: 'pointer' }}>+ {t('fiat.addAccount')}</span>
      </div>
      {store.bankAccounts.length === 0 ? (
        <div className="glass" style={{ borderRadius: '16px', padding: '18px', textAlign: 'center', fontSize: '12.5px', color: C.muted, fontWeight: 600 }}>{t('fiat.noAccounts')}</div>
      ) : (
        store.bankAccounts.map((a) => {
          const confirming = confirmDel === a.id;
          return (
            <div key={a.id} className="glass" style={{ borderRadius: '14px', padding: '12px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: C.muted, marginTop: '2px' }}>{railLabel(a.rail ?? a.type)}</div>
              </div>
              {confirming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => { setConfirmDel(null); store.removeFiatBankAccount(receiverId, a.id); }}
                    disabled={store.busy}
                    style={{ border: 'none', borderRadius: '999px', padding: '7px 14px', fontSize: '12px', fontWeight: 800, color: '#fff', background: C.danger, cursor: 'pointer' }}
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    onClick={() => setConfirmDel(null)}
                    className="glass-soft" style={{ border: 'none', borderRadius: '999px', padding: '7px 14px', fontSize: '12px', fontWeight: 800, color: 'var(--text)', cursor: 'pointer' }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(a.id)}
                  aria-label={t('fiat.deleteAccount')}
                  className="tap"
                  className="glass-soft" style={{ width: '34px', height: '34px', borderRadius: '50%', border: 'none', color: C.danger, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
