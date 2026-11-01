/**
 * Response contracts for easy recovery (`/v1/wallet/easy-recovery/*` on the community
 * server; see src/lib/easyRecovery.ts). What is asserted is what the wallet acts on: the
 * session id it puts back in a URL, the status both screens branch on, and the sealed
 * payload the new device opens.
 */
import { id, object, str, variant } from '@/lib/apiShape';

export type EasyRecoveryStatus = 'open' | 'offered' | 'claimed';

export const EasyRecoverySessionShape = object({ id, expiresAt: str });

const statusCase = object({ status: str, expiresAt: str });
export const EasyRecoveryStatusShape = variant<{ status: EasyRecoveryStatus; expiresAt: string }>('status', {
  open: statusCase,
  offered: statusCase,
  claimed: statusCase,
});

export const EasyRecoveryOfferedShape = object({ status: str });

export const EasyRecoveryClaimShape = object({ ciphertext: str });
