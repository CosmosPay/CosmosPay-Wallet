import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { RAILS } from '@/constants/fiat';
import { availableRails } from '@/lib/fiatRails';
import { Select } from '@/features/fiat/Select';
import { Field } from '@/ui/Field';
import '@/styles/features/fiat/bank-account.css';

/* --------------------------- deposit account ------------------------- */
/** Create a deposit/payout bank account for a currency/rail (LatAm-first). */
export function BankAccount({ store }: { store: WalletStore }) {
  const t = store.t;
  const receiverId = store.meta?.cosmosPayReceiverId;
  const [railType, setRailType] = useState(RAILS[0].type);
  const [name, setName] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});

  // Which rails the operator has actually enabled, from the gateway. Until it answers
  // — and forever, if it cannot — this is the full local table, which is exactly the
  // behaviour this screen had before. The field definitions always come from the local
  // table: the server says WHICH rails exist, this build says what each one needs.
  useEffect(() => {
    void store.loadRails();
  }, [store]);
  const rails = useMemo(() => availableRails(store.serverRails), [store.serverRails]);

  // The selected rail can fall out of the list when the server's answer arrives, so it
  // is resolved against `rails` with a fallback rather than trusted. Without that, a
  // rail the operator has disabled would keep its form on screen and submit into a 4xx.
  const rail = rails.find((r) => r.type === railType) ?? rails[0];
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
      // `rail.type`, not `railType`: they differ for exactly one render after the
      // server's rail list lands and invalidates the current selection.
      type: rail.type,
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
      <BackBar title={t('fiat.addAccount')} onBack={store.goBack} />
      <div className="desc bank-desc">{t('fiat.accountDesc')}</div>
      <Select label={t('fiat.currency')} value={rail.type} onChange={changeRail}>
        {rails.map((r) => <option key={r.type} value={r.type}>{t(r.labelKey)}</option>)}
      </Select>
      <Field tone="soft" label={t('fiat.accountName')} value={name} onChange={setName} placeholder={t('fiat.accountNamePlaceholder')} />
      {rail.fields.map((f) =>
        f.options ? (
          <Select key={f.k} label={t(f.labelKey)} value={vals[f.k] ?? f.options[0]} onChange={(v) => set(f.k, v)}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Field tone="soft" key={f.k} label={t(f.labelKey)} value={vals[f.k] ?? ''} onChange={(v) => set(f.k, v)} />
        ),
      )}
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ok || store.busy} onClick={submit}>{store.busy ? <Spinner /> : t('fiat.addAccount')}</PrimaryButton>
      </div>
    </div>
  );
}
