import type { WalletStore } from '@/components/store';
import '@/styles/screens/cosmos-pay.css';

/** One network's Cosmos Pay key: status + per-network unlink. */
export function CosmosPayEnvRow({ store, net, env, present }: { store: WalletStore; net: string; env: 'dev' | 'prod'; present: boolean }) {
  const t = store.t;
  return (
    <div className="cosmospay-env">
      <div>
        <div className="cosmospay-env-net">{net}</div>
        <div className={present ? 'cosmospay-env-status is-linked' : 'cosmospay-env-status'}>{present ? t('cosmospay.keyLinked') : t('cosmospay.keyMissing')}</div>
      </div>
      {present && (
        <button onClick={() => store.unlinkCosmosPayEnv(env)} className="cosmospay-unlink-btn">
          {t('cosmospay.unlinkReceiver')}
        </button>
      )}
    </div>
  );
}
