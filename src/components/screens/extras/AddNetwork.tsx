import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';

/* --------------------------- ADD NETWORK ---------------------------- */
export function AddNetwork({ store }: { store: WalletStore }) {
  const t = store.t;
  const [name, setName] = useState('');
  const [horizon, setHorizon] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 1 && /^https?:\/\/.+/.test(horizon.trim()) && passphrase.trim().length > 3 && !busy;

  const save = async () => {
    setBusy(true);
    try {
      await store.addNetwork({ label: name.trim(), horizon: horizon.trim().replace(/\/$/, ''), passphrase: passphrase.trim() });
      store.go('home', 'home');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr screen col">
      <BackBar title={t('net.addTitle')} onBack={() => store.go(store.session ? 'home' : 'home', 'home')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>
        {t('settings.networkDesc')}
      </div>
      <Field label={t('net.name')} value={name} onChange={setName} placeholder="Futurenet" />
      <Field label={t('net.horizon')} value={horizon} onChange={setHorizon} placeholder="https://horizon-futurenet.stellar.org" />
      <Field label={t('net.passphrase')} value={passphrase} onChange={setPassphrase} placeholder="Test SDF Future Network ; October 2022" />
      <div style={{ flex: 1 }} />
      <PrimaryButton disabled={!ok} onClick={save}>{busy ? <Spinner /> : t('net.save')}</PrimaryButton>
    </div>
  );
}
