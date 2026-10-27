/**
 * Whose transactions the manual "sign transaction" screen may sign: this account's own, and those
 * of an account this account's key alone controls. The second is a sub-account, such as a Cosmos
 * Pay private sub-account: a Stellar account its owner created whose only signer is the owner's
 * account (its own key at weight 0), so every one of its transactions (a register on the private
 * token, a deposit) is signed with the owner's key and has the sub-account as its source. Who
 * controls an account is read from the network, never taken from the envelope.
 *
 * Anyone can add any key as a signer of their own account, so being listed is not enough: the key
 * must be the only signer with weight, meeting every threshold (an account that kept another
 * signer is not this key's). And the signature must authorize that account and nothing else: a
 * foreign-source envelope with an operation of another source (this account's, above all) or a
 * fee-bump wrapper would spend from elsewhere under a prompt that names the sub-account.
 */
import { getServer, type NetConfig } from '@/lib/stellar';
import type { TxReview } from '@/lib/txGuard';

/** An account's signer as Horizon lists it (its own key included, at its master weight). */
export interface AccountSigner {
  key: string;
  weight: number;
  type?: string;
}

/** An account's thresholds as Horizon lists them. */
export interface AccountThresholds {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

/** Whether `key` alone controls an account: its only signer with weight, an ed25519 key, and
 *  enough for every threshold. */
export function controlledBy(signers: readonly AccountSigner[], thresholds: AccountThresholds, key: string): boolean {
  const weighted = signers.filter((s) => s.weight > 0);
  if (weighted.length !== 1) return false;
  const [only] = weighted;
  const needed = Math.max(1, thresholds.low_threshold, thresholds.med_threshold, thresholds.high_threshold);
  return only.key === key && (only.type ?? 'ed25519_public_key') === 'ed25519_public_key' && only.weight >= needed;
}

/** Whether `key` alone controls `account` on the network; false when it cannot be read. */
export async function controlsAccount(cfg: NetConfig, account: string, key: string): Promise<boolean> {
  try {
    const loaded = await getServer(cfg).loadAccount(account);
    return controlledBy(loaded.signers as AccountSigner[], loaded.thresholds as AccountThresholds, key);
  } catch {
    return false;
  }
}

/** Why another account's envelope would authorize more than that account, or null: an operation
 *  of another source, or a fee-bump wrapper. */
export function foreignEnvelopeProblem(review: Pick<TxReview, 'source' | 'operations' | 'feeBumpSource'>): 'sign.foreignOps' | null {
  if (review.feeBumpSource) return 'sign.foreignOps';
  return review.operations.some((op) => op.source !== null && op.source !== review.source) ? 'sign.foreignOps' : null;
}
