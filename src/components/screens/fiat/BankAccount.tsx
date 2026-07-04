import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { RAILS } from '@/constants/fiat';
import { Field, Select } from './shared';

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
    <div className="scr screen col pb-104">
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
