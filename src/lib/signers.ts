/**
 * Whose transactions the manual "sign transaction" screen may sign: this account's own, and those
 * of an account that lists this account's key as one of its signers. The second is a sub-account
 * this key controls, such as a Cosmos Pay private sub-account: a Stellar account its owner
 * created whose only signer is the owner's account, so every one of its transactions (a register
 * on the private token, a deposit) is signed with the owner's key and has the sub-account as its
 * source. Who signs for an account is read from the network, never taken from the envelope.
 */
import { getServer, type NetConfig } from '@/lib/stellar';

/** An account's signer as Horizon lists it. */
export interface AccountSigner {
  key: string;
  weight: number;
  type?: string;
}

/** Whether `key` signs for an account with these signers: an ed25519 signer with weight. */
export function signsFor(signers: readonly AccountSigner[], key: string): boolean {
  return signers.some((s) => s.key === key && s.weight > 0 && (s.type ?? 'ed25519_public_key') === 'ed25519_public_key');
}

/** Whether `key` is one of `account`'s signers on the network; false when it cannot be read. */
export async function signsForAccount(cfg: NetConfig, account: string, key: string): Promise<boolean> {
  try {
    const loaded = await getServer(cfg).loadAccount(account);
    return signsFor(loaded.signers as AccountSigner[], key);
  } catch {
    return false;
  }
}
