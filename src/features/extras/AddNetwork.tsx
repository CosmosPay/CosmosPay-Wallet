import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { useBusy } from '@/hooks/useBusy';
import { horizonUrlProblem, isSafeHorizonUrl } from '@/lib/validate';
import '@/styles/features/extras/add-network.css';

/* --------------------------- ADD NETWORK ---------------------------- */
export function AddNetwork({ store }: { store: WalletStore }) {
  const t = store.t;
  const [name, setName] = useState('');
  const [horizon, setHorizon] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useBusy();
  const horizonErr = horizonUrlProblem(horizon);
  const ok = name.trim().length > 1 && isSafeHorizonUrl(horizon) && passphrase.trim().length > 3 && !busy;

  const save = () =>
    run(async () => {
      setErr('');
      try {
        await store.addNetwork({ label: name.trim(), horizon: horizon.trim().replace(/\/$/, ''), passphrase: passphrase.trim() });
        store.go('home', 'home');
      } catch (e) {
        setErr((e as Error).message);
      }
    });

  return (
    <div className="scr screen col">
      <BackBar title={t('net.addTitle')} onBack={store.goBack} />
      <div className="add-network-desc">
        {t('settings.networkDesc')}
      </div>
      <Field label={t('net.name')} value={name} onChange={setName} placeholder="Futurenet" />
      <Field label={t('net.horizon')} value={horizon} onChange={setHorizon} placeholder="https://horizon-futurenet.stellar.org" />
      {horizonErr && <div className="add-network-err">{horizonErr}</div>}
      <Field label={t('net.passphrase')} value={passphrase} onChange={setPassphrase} placeholder="Test SDF Future Network ; October 2022" />
      {err && <div className="add-network-err">{err}</div>}
      <div className="f1" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ok} onClick={save}>{busy ? <Spinner /> : t('net.save')}</PrimaryButton>
      </div>
    </div>
  );
}
