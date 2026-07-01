import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner, inputStyle } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import type { FiatToken, Payin, PayinMethod, PayinQuote, PayinQuoteInput, PayoutQuote } from '@/lib/cosmospay';

/* BlindPay fiat (on/off-ramp). LatAm-first. Needs a `standard` KYC receiver (photo ID +
   selfie) kept as the wallet's default; once verified, the hub exposes deposit/withdraw. */

const COUNTRIES = [
  { code: 'BR', name: 'Brasil' },
  { code: 'CO', name: 'Colombia' },
  { code: 'AR', name: 'Argentina' },
  { code: 'MX', name: 'México' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Perú' },
  { code: 'UY', name: 'Uruguay' },
];
const DOC_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'];

/* Deposit/payout rails per currency (LatAm-first). Each `field` maps to the BlindPay
   bank-account body; `options` renders a select. */
type RailField = { k: string; label: string; options?: string[] };
const RAILS: { type: string; label: string; fields: RailField[] }[] = [
  { type: 'pix', label: 'PIX · Brasil (BRL)', fields: [{ k: 'pix_key', label: 'Clave PIX' }, { k: 'tax_id', label: 'CPF' }] },
  { type: 'spei_bitso', label: 'SPEI · México (MXN)', fields: [{ k: 'beneficiary_name', label: 'Beneficiario' }, { k: 'spei_clabe', label: 'CLABE (18 dígitos)' }] },
  { type: 'transfers_bitso', label: 'Transferencia · Argentina (ARS)', fields: [{ k: 'transfers_account', label: 'CBU / CVU / Alias' }, { k: 'transfers_type', label: 'Tipo', options: ['CBU', 'CVU', 'ALIAS'] }, { k: 'tax_id', label: 'CUIT / CUIL' }] },
  { type: 'ach_cop_bitso', label: 'ACH · Colombia (COP)', fields: [{ k: 'ach_cop_beneficiary_first_name', label: 'Nombre' }, { k: 'ach_cop_beneficiary_last_name', label: 'Apellido' }, { k: 'ach_cop_document_type', label: 'Tipo doc', options: ['CC', 'NIT', 'CE'] }, { k: 'ach_cop_document_id', label: 'Documento' }, { k: 'ach_cop_bank_code', label: 'Código de banco' }, { k: 'account_number', label: 'Nº de cuenta' }, { k: 'ach_cop_email', label: 'Email' }] },
  { type: 'ted', label: 'TED · Brasil (BRL)', fields: [{ k: 'ted_bank_code', label: 'Código de banco' }, { k: 'ted_branch_code', label: 'Agencia' }, { k: 'account_number', label: 'Nº de cuenta' }, { k: 'ted_cpf_cnpj', label: 'CPF / CNPJ' }] },
  { type: 'ach', label: 'ACH · EE. UU. (USD)', fields: [{ k: 'beneficiary_name', label: 'Beneficiario' }, { k: 'account_number', label: 'Account number' }, { k: 'routing_number', label: 'Routing number' }] },
];

/** Friendly label for a saved bank account's rail type (null-safe; falls back to the
 *  upper-cased raw type, or '' when the type is missing). */
const railLabel = (type?: string | null) =>
  type ? (RAILS.find((r) => r.type === type)?.label ?? type.replace(/_/g, ' ').toUpperCase()) : '';

/** ISO currency for a BlindPay rail / payin method (used as the fiat amount suffix). */
const RAIL_CCY: Record<string, string> = {
  pix: 'BRL', pix_safe: 'BRL', ted: 'BRL',
  spei: 'MXN', spei_bitso: 'MXN',
  transfers: 'ARS', transfers_bitso: 'ARS',
  pse: 'COP', ach_cop_bitso: 'COP',
  ach: 'USD', wire: 'USD', rtp: 'USD', international_swift: 'USD',
  sepa: 'EUR',
};
const railCurrency = (rail?: string | null) => (rail ? RAIL_CCY[rail] ?? '' : '');

/* ---- onramp/offramp helpers ---- */
const STABLES = ['USDC', 'USDT', 'USDB'];
/** Minor units (cents) -> "12.34". */
const fmtMinor = (n?: number | null) => (n == null ? '—' : (n / 100).toFixed(2));
/** Local fiat (minor units) -> whole units, grouped, no centavos (e.g. ARS "15.615"). */
const fmtFiat = (n?: number | null) => (n == null ? '—' : Math.round(n / 100).toLocaleString('es-AR'));
/** "12.34" -> 1234 minor units (the API takes integer cents). */
const toMinor = (s: string) => Math.round((parseFloat(s) || 0) * 100);

/** Trusted stablecoins on the wallet. `withBalance` keeps only those with a spendable balance. */
function stableTokens(store: WalletStore, withBalance = false): { code: string; balance: number }[] {
  return (store.account?.balances ?? [])
    .filter((b) => !b.isNative && STABLES.includes(b.code))
    .map((b) => ({ code: b.code, balance: parseFloat(b.balance) || 0 }))
    .filter((b) => (withBalance ? b.balance > 0 : true));
}

/** Onramp payment methods (LatAm-first) with the per-method payer fields BlindPay requires. */
type PayerField = { k: string; label: string; options?: string[] };
const PAY_METHODS: { method: PayinMethod; label: string; payer?: PayerField[] }[] = [
  { method: 'pix', label: 'PIX · Brasil (BRL)' },
  { method: 'spei', label: 'SPEI · México (MXN)' },
  {
    method: 'transfers',
    label: 'Transferencia · Argentina (ARS)',
    payer: [{ k: 'transfers_allowed_tax_id', label: 'CUIT/CUIL del pagador' }],
  },
  {
    method: 'pse',
    label: 'PSE · Colombia (COP)',
    payer: [
      { k: 'pse_full_name', label: 'Nombre completo' },
      { k: 'pse_document_type', label: 'Tipo doc', options: ['CC', 'NIT'] },
      { k: 'pse_document_number', label: 'Nº de documento' },
      { k: 'pse_email', label: 'Email' },
      { k: 'pse_phone', label: 'Teléfono' },
      { k: 'pse_bank_code', label: 'Código de banco' },
    ],
  },
  { method: 'ted', label: 'TED · Brasil (BRL)' },
  { method: 'ach', label: 'ACH · EE. UU. (USD)' },
  { method: 'wire', label: 'Wire · EE. UU. (USD)' },
  { method: 'rtp', label: 'RTP · EE. UU. (USD)' },
];

export function Fiat({ store }: { store: WalletStore }) {
  const receiverId = store.meta?.cosmosPayReceiverId;

  useEffect(() => {
    store.loadReceivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.meta?.id, store.network.id]);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      {receiverId ? <ReceiverHub store={store} receiverId={receiverId} /> : <CreateReceiver store={store} />}
    </div>
  );
}

/* ---------------------------- KYC wizard ----------------------------- */

const fieldLabel: CSSProperties = { fontSize: '12px', color: 'var(--muted)', fontWeight: 700, margin: '0 2px 6px' };
const fieldInput: CSSProperties = { ...inputStyle, background: C.cardSolid, border: '1px solid var(--glass-border)' };

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: 'block', marginBottom: '12px' }}>
      <div style={fieldLabel}>{label}</div>
      <input value={value} type={type} onChange={(e) => onChange((e.target as HTMLInputElement).value)} placeholder={placeholder} style={fieldInput} />
    </label>
  );
}

/** Native <select> styled to match the app's pill inputs (glass + chevron). Keeps the
 *  OS picker (best for mobile) while looking on-brand. `style` is merged onto the label
 *  so it can flex inside a row. */
function Select({ label, value, onChange, children, style }: { label?: string; value: string; onChange: (v: string) => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <label style={{ display: 'block', marginBottom: '12px', ...style }}>
      {label && <div style={fieldLabel}>{label}</div>}
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
          style={{ ...fieldInput, appearance: 'none', WebkitAppearance: 'none', paddingRight: '42px', cursor: 'pointer' }}
        >
          {children}
        </select>
        <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '10px', color: C.muted, opacity: 0.85 }}>▼</span>
      </div>
    </label>
  );
}

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
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}><Field label={t('fiat.firstName')} value={firstName} onChange={setFirstName} /></div>
            <div style={{ flex: 1 }}><Field label={t('fiat.lastName')} value={lastName} onChange={setLastName} /></div>
          </div>
          <Field label={t('fiat.email')} value={email} onChange={setEmail} type="email" />
          <div style={{ display: 'flex', gap: '10px' }}>
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
          <div style={{ display: 'flex', gap: '10px' }}>
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
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px', borderRadius: '20px', cursor: 'pointer', ...C.glass, marginBottom: '12px' }}>
      <div style={{ width: '46px', height: '46px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{icon}</svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: '12.5px', color: C.muted, fontWeight: 600 }}>{desc}</div>
      </div>
      <span style={{ color: C.dim, fontSize: '20px' }}>›</span>
    </div>
  );

  return (
    <>
      <BackBar title={t('fiat.title')} onBack={() => store.go('home', 'home')} />
      <div style={{ ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '18px' }}>
        <div style={{ fontSize: '12px', color: C.muted, fontWeight: 700, marginBottom: '6px' }}>{t('fiat.account')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        <div style={{ ...C.glass, borderRadius: '16px', padding: '18px', textAlign: 'center', fontSize: '12.5px', color: C.muted, fontWeight: 600 }}>{t('fiat.noAccounts')}</div>
      ) : (
        store.bankAccounts.map((a) => {
          const confirming = confirmDel === a.id;
          return (
            <div key={a.id} style={{ ...C.glass, borderRadius: '14px', padding: '12px 14px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
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
                    style={{ ...C.glassSoft, border: 'none', borderRadius: '999px', padding: '7px 14px', fontSize: '12px', fontWeight: 800, color: 'var(--text)', cursor: 'pointer' }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(a.id)}
                  aria-label={t('fiat.deleteAccount')}
                  className="tap"
                  style={{ width: '34px', height: '34px', borderRadius: '50%', ...C.glassSoft, border: 'none', color: C.danger, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
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

/* --------------------------- deposit account ------------------------- */
/** Create a deposit/payout bank account for a currency/rail (LatAm-first). */
export function BankAccount({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;
  const [railType, setRailType] = useState(RAILS[0].type);
  const [name, setName] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const rail = RAILS.find((r) => r.type === railType) ?? RAILS[0];
  const ok = !!name.trim() && rail.fields.every((f) => (f.options ? true : (vals[f.k] ?? '').trim()));

  // BlindPay requires a top-level `beneficiary_name` on every bank account. Default it to
  // the receiver's KYC'd name (the API returns `name`; fall back to first+last), and finally
  // to the account label so the field is never empty. Rails that collect their own
  // beneficiary field (spei/ach) override it in the loop below.
  const receiver = store.receivers.find((r) => r.id === receiverId) ?? null;
  const beneficiaryName = (receiver?.name || [receiver?.first_name, receiver?.last_name].filter(Boolean).join(' ')).trim();

  const changeRail = (type: string) => { setRailType(type); setVals({}); };
  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!receiverId) return;
    const body: Record<string, unknown> = {
      type: railType,
      name: name.trim(),
      beneficiary_name: beneficiaryName || name.trim(),
      account_class: 'individual',
    };
    for (const f of rail.fields) {
      const v = f.options ? vals[f.k] ?? f.options[0] : (vals[f.k] ?? '').trim();
      if (v) body[f.k] = v;
    }
    const okR = await store.addFiatBankAccount(receiverId, body);
    if (okR) store.setScreen('fiat');
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('fiat.addAccount')} onBack={() => store.setScreen('fiat')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '4px 2px 16px' }}>{t('fiat.accountDesc')}</div>
      <Select label={t('fiat.currency')} value={railType} onChange={changeRail}>
        {RAILS.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
      </Select>
      <Field label={t('fiat.accountName')} value={name} onChange={setName} placeholder={t('fiat.accountNamePlaceholder')} />
      {rail.fields.map((f) =>
        f.options ? (
          <Select key={f.k} label={f.label} value={vals[f.k] ?? f.options[0]} onChange={(v) => set(f.k, v)}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Field key={f.k} label={f.label} value={vals[f.k] ?? ''} onChange={(v) => set(f.k, v)} />
        ),
      )}
      <div style={{ flex: 1, minHeight: '12px' }} />
      <PrimaryButton disabled={!ok || store.busy} onClick={submit}>{store.busy ? <Spinner /> : t('fiat.addAccount')}</PrimaryButton>
    </div>
  );
}

/* ----------------------- deposit / withdraw (onramp / offramp) ----------------------- */

const SCR_STYLE: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' };
const quoteCardStyle: CSSProperties = { ...C.glass, borderRadius: '16px', padding: '4px 16px', marginTop: '14px' };

function QuoteRow({ label, val, last }: { label: string; val: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--hairline)' }}>
      <span style={{ color: C.muted, fontSize: '13px', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  );
}

/** Deposit fiat → crypto. Quote → create payin → show the payer's funding instructions. */
export function Deposit({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;
  const tokens = stableTokens(store); // a trusted stablecoin is needed to receive the mint
  const [token, setToken] = useState<FiatToken>((tokens[0]?.code as FiatToken) ?? 'USDC');
  const [method, setMethod] = useState<PayinMethod>('pix');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<PayinQuote | null>(null);
  const [payin, setPayin] = useState<Payin | null>(null);

  const cfg = PAY_METHODS.find((m) => m.method === method) ?? PAY_METHODS[0];
  const payerOk = (cfg.payer ?? []).every((f) => (f.options ? true : (payer[f.k] ?? '').trim()));
  const canQuote = !!receiverId && !!token && toMinor(amount) >= 1 && payerOk && !store.busy;

  const setP = (k: string, v: string) => setPayer((s) => ({ ...s, [k]: v }));
  const changeMethod = (m: string) => { setMethod(m as PayinMethod); setPayer({}); setQuote(null); };

  const buildPayerRules = () => {
    if (!cfg.payer?.length) return undefined;
    const r: Record<string, unknown> = {};
    for (const f of cfg.payer) {
      const v = f.options ? payer[f.k] ?? f.options[0] : (payer[f.k] ?? '').trim();
      if (v) r[f.k] = v;
    }
    return r;
  };

  const getQuote = async () => {
    if (!receiverId) return;
    const bwId = await store.ensureBlockchainWallet(receiverId); // blockchain_wallet_id (registers if needed)
    if (!bwId) return;
    const q = await store.quoteDeposit({
      blockchain_wallet_id: bwId,
      currency_type: 'sender',
      payment_method: method,
      token,
      request_amount: toMinor(amount),
      payer_rules: buildPayerRules() as PayinQuoteInput['payer_rules'],
    });
    if (q) setQuote(q);
  };

  const confirm = async () => {
    if (!quote) return;
    const p = await store.confirmDeposit(quote.id);
    if (p) setPayin(p);
  };

  if (payin) return <DepositInstructions store={store} payin={payin} onDone={() => store.setScreen('fiat')} />;

  if (!tokens.length) {
    return (
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
        <div style={{ ...C.glass, borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>{t('fiat.noTrustedToken')}</div>
        <PrimaryButton onClick={() => store.setScreen('add-asset')}>{t('fiat.addTrustline')}</PrimaryButton>
      </div>
    );
  }

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.depositTitle')} onBack={() => store.setScreen('fiat')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.depositDesc')}</div>

      <Select label={t('fiat.method')} value={method} onChange={changeMethod}>
        {PAY_METHODS.map((m) => <option key={m.method} value={m.method}>{m.label}</option>)}
      </Select>
      <Select label={t('fiat.token')} value={token} onChange={(v) => { setToken(v as FiatToken); setQuote(null); }}>
        {tokens.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
      </Select>
      <Field label={t('fiat.payAmount')} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} placeholder="0.00" />
      {(cfg.payer ?? []).map((f) =>
        f.options ? (
          <Select key={f.k} label={f.label} value={payer[f.k] ?? f.options[0]} onChange={(v) => setP(f.k, v)}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Field key={f.k} label={f.label} value={payer[f.k] ?? ''} onChange={(v) => setP(f.k, v)} />
        ),
      )}

      {quote && (
        <div style={quoteCardStyle}>
          <QuoteRow label={t('fiat.youPay')} val={`${fmtFiat(quote.sender_amount)}${railCurrency(method) ? ` ${railCurrency(method)}` : ''}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtMinor(quote.receiver_amount)} ${token}`} last />
        </div>
      )}

      <div style={{ flex: 1, minHeight: '12px' }} />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmDeposit')}</PrimaryButton>
          <div style={{ height: '8px' }} />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
      )}
      <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, textAlign: 'center', marginTop: '10px', lineHeight: 1.5 }}>{t('fiat.quoteNote')}</div>
    </div>
  );
}

/** Funding instructions for a created payin (PIX code, CLABE, CBU, memo + bank details, PSE link). */
function DepositInstructions({ store, payin, onDone }: { store: WalletStore; payin: Payin; onDone: () => void }) {
  const t = store.t;
  const ins = payin.instructions ?? {};
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => { if (typeof v === 'string' && v) rows.push({ label, value: v }); };
  push(t('fiat.ins.pixCode'), ins.pix_code);
  push(t('fiat.ins.clabe'), ins.clabe);
  push(t('fiat.ins.cbu'), ins.cbu);
  push(t('fiat.ins.memoCode'), ins.memo_code);
  push(t('fiat.ins.pseLink'), ins.pse_payment_link);
  const bank = ins.blindpay_bank_details && typeof ins.blindpay_bank_details === 'object' ? (ins.blindpay_bank_details as Record<string, unknown>) : null;

  const copy = async (v: string) => { await copyText(v); store.flash(t('fiat.copied'), 'ok'); };

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.depositInstructions')} onBack={onDone} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.depositInstructionsDesc')}</div>
      <div style={{ ...C.glass, borderRadius: '14px', padding: '12px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', color: C.muted, fontWeight: 700 }}>{t('fiat.status')}</span>
        <span style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase' }}>{payin.status ?? '—'}</span>
      </div>
      {rows.length === 0 && !bank && (
        <div style={{ ...C.glass, borderRadius: '16px', padding: '18px', fontSize: '12.5px', color: C.muted, fontWeight: 600, textAlign: 'center' }}>{t('fiat.insPending')}</div>
      )}
      {rows.map((r) => (
        <div key={r.label} style={{ ...C.glass, borderRadius: '14px', padding: '12px 14px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11.5px', color: C.muted, fontWeight: 700, marginBottom: '4px' }}>{r.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, wordBreak: 'break-all', fontFamily: 'monospace' }}>{r.value}</span>
            <button onClick={() => copy(r.value)} className="tap" style={{ ...C.glassSoft, border: 'none', borderRadius: '999px', padding: '7px 12px', fontSize: '12px', fontWeight: 800, color: 'var(--text)', cursor: 'pointer', flexShrink: 0 }}>{t('fiat.copy')}</button>
          </div>
        </div>
      ))}
      {bank && (
        <div style={{ ...C.glass, borderRadius: '14px', padding: '12px 14px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11.5px', color: C.muted, fontWeight: 700, marginBottom: '6px' }}>{t('fiat.ins.bankDetails')}</div>
          {Object.entries(bank).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0', fontSize: '12.5px' }}>
              <span style={{ color: C.dim, fontWeight: 600 }}>{k}</span>
              <span style={{ fontWeight: 700, wordBreak: 'break-all', textAlign: 'right' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: '12px' }} />
      <PrimaryButton onClick={onDone}>{t('common.done')}</PrimaryButton>
    </div>
  );
}

/** Withdraw crypto → fiat. Quote → authorize → sign locally → create payout. */
export function Withdraw({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;

  useEffect(() => {
    if (receiverId) store.loadBankAccounts(receiverId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const accounts = store.bankAccounts;
  const tokens = stableTokens(store, true); // must hold the token to send it
  const [bankId, setBankId] = useState('');
  const [token, setToken] = useState<FiatToken>((tokens[0]?.code as FiatToken) ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [coverFees, setCoverFees] = useState(true);
  const [quote, setQuote] = useState<PayoutQuote | null>(null);

  useEffect(() => { if (!bankId && accounts[0]) setBankId(accounts[0].id); }, [accounts, bankId]);

  const account = accounts.find((a) => a.id === bankId) ?? null;
  const ccy = railCurrency(account?.rail ?? account?.type); // fiat currency for the amount suffix
  const bal = tokens.find((x) => x.code === token)?.balance ?? 0;
  const insufficient = (parseFloat(amount) || 0) > bal;
  const canQuote = !!bankId && !!token && toMinor(amount) >= 1 && !insufficient && !store.busy;

  const getQuote = async () => {
    const q = await store.quoteWithdraw({ bank_account_id: bankId, request_amount: toMinor(amount), token, cover_fees: coverFees });
    if (q) setQuote(q);
  };
  const confirm = async () => { if (quote) await store.confirmWithdraw(quote, token, ccy); };

  if (!accounts.length) {
    return (
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
        <div style={{ ...C.glass, borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>{t('fiat.needBankAccount')}</div>
        <PrimaryButton onClick={() => store.setScreen('bankaccount')}>{t('fiat.addAccount')}</PrimaryButton>
      </div>
    );
  }
  if (!tokens.length) {
    return (
      <div className="scr" style={SCR_STYLE}>
        <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
        <div style={{ ...C.glass, borderRadius: '16px', padding: '18px', fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5 }}>{t('fiat.noTokenBalance')}</div>
      </div>
    );
  }

  return (
    <div className="scr" style={SCR_STYLE}>
      <BackBar title={t('fiat.withdrawTitle')} onBack={() => store.setScreen('fiat')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '2px 2px 14px' }}>{t('fiat.withdrawDesc')}</div>

      <Select label={t('fiat.bankAccount')} value={bankId} onChange={(v) => { setBankId(v); setQuote(null); }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {railLabel(a.rail ?? a.type)}</option>)}
      </Select>
      <Select label={t('fiat.token')} value={token} onChange={(v) => { setToken(v as FiatToken); setQuote(null); }}>
        {tokens.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.balance.toFixed(2)}</option>)}
      </Select>
      <Field label={t('fiat.sendAmount')} value={amount} onChange={(v) => { setAmount(v); setQuote(null); }} placeholder="0.00" />
      <div style={{ fontSize: '11.5px', color: insufficient ? C.danger : C.dim, fontWeight: 700, margin: '-4px 2px 12px' }}>
        {t('fiat.balance')}: {bal.toFixed(2)} {token}
      </div>

      <div onClick={() => { setCoverFees((v) => !v); setQuote(null); }} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...C.glass, borderRadius: '14px', padding: '14px 16px', marginBottom: '12px', cursor: 'pointer' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>{t('fiat.coverFees')}</span>
        <span style={{ width: '44px', height: '26px', borderRadius: '999px', background: coverFees ? C.accent : 'var(--surface)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: '3px', left: coverFees ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
        </span>
      </div>

      {quote && (
        <div style={quoteCardStyle}>
          <QuoteRow label={t('fiat.youSend')} val={`${fmtMinor(quote.sender_amount)} ${token}`} />
          <QuoteRow label={t('fiat.youReceive')} val={`${fmtFiat(quote.receiver_local_amount || quote.receiver_amount)}${ccy ? ` ${ccy}` : ''}`} last />
        </div>
      )}

      <div style={{ flex: 1, minHeight: '12px' }} />
      {quote ? (
        <>
          <PrimaryButton disabled={store.busy} onClick={confirm}>{store.busy ? <Spinner /> : t('fiat.confirmWithdraw')}</PrimaryButton>
          <div style={{ height: '8px' }} />
          <GhostButton onClick={() => setQuote(null)}>{t('fiat.editQuote')}</GhostButton>
        </>
      ) : (
        <PrimaryButton disabled={!canQuote} onClick={getQuote}>{store.busy ? <Spinner /> : t('fiat.getQuote')}</PrimaryButton>
      )}
      <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, textAlign: 'center', marginTop: '10px', lineHeight: 1.5 }}>{t('fiat.withdrawSignNote')}</div>
    </div>
  );
}
