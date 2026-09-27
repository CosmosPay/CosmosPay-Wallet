import { useEffect, useState } from 'react';
import { recoveryReachable } from '@/lib/recovery';
import type { NetConfig } from '@/lib/stellar';

/**
 * Whether both recovery servers answer on this network — `null` while asking.
 *
 * For the screens that OFFER recovery (the Home card, Settings, "forgot the password?"):
 * an offer is only worth showing when the flow behind it can start. See
 * `recoveryReachable` for why "two URLs are configured" is not that.
 */
export function useRecoveryReachable(network: NetConfig): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setOk(null);
    void recoveryReachable(network).then((v) => {
      if (live) setOk(v);
    });
    return () => {
      live = false;
    };
  }, [network]);
  return ok;
}
