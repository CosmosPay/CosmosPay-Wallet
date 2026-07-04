import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, EnableReceivingCard } from '@/components/parts';
import { ageFromBirthdate } from '@/lib/greeting';

/* Cosmos Pay integration manager: link / unlink the API keys per network (testnet/mainnet)
   and the BlindPay fiat receiver. Cosmos Pay is an integration — not "receiving payments". */

export function CosmosPay({ store }: { store: WalletStore }) {
  const t = store.t;
  const cp = store.cosmosPay;
  const receiverId = store.meta?.cosmosPayReceiverId;
  // While a connect / re-link flow is running, show its card even if some keys already exist.
  const flowActive = !!store.cosmosLink || !!store.cosmosPayPending;
  // Fiat (BlindPay receiver) is 18+ only — minors don't get the option at all.
  const adult = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;

  const sectionLabel = { fontSize: '13px', fontWeight: 800, letterSpacing: '-.2px', margin: '20px 2px 10px' } as const;
  const card = { ...C.glass, borderRadius: '18px', padding: '18px' } as const;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0' }}>
      <span style={{ fontSize: '13px', color: C.muted, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '13.5px', fontWeight: 700, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );

  // One network's key: status + per-network unlink.
  const EnvRow = ({ net, env, present }: { net: string; env: 'dev' | 'prod'; present: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--hairline)' }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 800 }}>{net}</div>
        <div style={{ fontSize: '12px', color: present ? 'var(--up)' : C.muted, fontWeight: 600 }}>{present ? t('cosmospay.keyLinked') : t('cosmospay.keyMissing')}</div>
      </div>
      {present && (
        <button onClick={() => store.unlinkCosmosPayEnv(env)} style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: C.danger, borderRadius: '999px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}>
          {t('cosmospay.unlinkReceiver')}
        </button>
      )}
    </div>
  );

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title="Cosmos Pay" onBack={() => store.back('profile')} />
      <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '4px 2px 4px' }}>{t('cosmospay.integrationDesc')}</div>

      {/* API keys — per network */}
      <div style={sectionLabel}>{t('cosmospay.apiKeys')}</div>
      {!cp || flowActive ? (
        <EnableReceivingCard store={store} />
      ) : (
        <div style={card}>
          <Row label={t('cosmospay.org')} value={cp.organizationId ? cp.organizationId.slice(0, 12) + '…' : '—'} />
          <EnvRow net="Testnet" env="dev" present={!!cp.keys.dev} />
          <EnvRow net="Mainnet" env="prod" present={!!cp.keys.prod} />
          <GhostButton onClick={() => store.enableReceiving()} style={{ marginTop: '14px' }}>{t('cosmospay.reconnect')}</GhostButton>
        </div>
      )}

      {/* Receiver (fiat / BlindPay) — hidden entirely for minors (18+ only). */}
      {adult && <div style={sectionLabel}>{t('cosmospay.receiverSection')}</div>}
      {!adult ? null : receiverId ? (
        <div style={card}>
          <Row label={t('fiat.account')} value={receiverId.slice(0, 12) + '…'} />
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <GhostButton onClick={() => store.setScreen('fiat')} style={{ flex: 1 }}>{t('cosmospay.manageReceiver')}</GhostButton>
            <GhostButton onClick={() => store.unlinkReceiver()} style={{ flex: 1, color: C.danger }}>{t('cosmospay.unlinkReceiver')}</GhostButton>
          </div>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '14px' }}>{t('cosmospay.noReceiver')}</div>
          <PrimaryButton disabled={!cp} onClick={() => store.setScreen('fiat')}>{t('cosmospay.linkReceiver')}</PrimaryButton>
        </div>
      )}
    </div>
  );
}
