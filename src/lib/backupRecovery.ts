/**
 * Email recovery for the cloud backup — the door that answers "I forgot my password and
 * this device has no passkey", without giving up the seed the way SEP-30 does.
 *
 * ## How it holds
 *
 * A random 32-byte key K seals the backup's data key as its `recovery` door
 * (`lib/cloudBackup.ts`). K itself is never stored anywhere: it is split by XOR into two
 * halves, and each recovery server keeps one (`/v1/sep30/shares/<address>`), filed with
 * the account's SEP-10 token and handed back only to whoever proves the filed email to
 * THAT server — an Authentik ID token each verifies on its own, or each one's own emailed
 * code. Both halves are needed; either alone is uniformly random and says nothing about K.
 *
 * ## What it costs
 *
 * The two servers TOGETHER — or someone who controls the inbox and gets both to accept it —
 * can open a backup that has this door. That is the trade a person makes for "recover with
 * my email", and why it rests on the same two independent deployments SEP-30 does, never
 * one: a single server holding K would be a custodian.
 *
 * Filing happens with the key in hand (a sign-in, a restore, a password change); taking
 * back happens with the identity proof the recovery screen already gathers.
 */
import { BACKUP_RECOVERY_KEY_BYTES } from '@/constants/recovery';
import { ApiRequestError } from '@/lib/apiError';
import { recoveryShareFile, recoveryShareTake } from '@/lib/cosmospay';
import { fromBase64, toBase64 } from '@/lib/crypto';
import { authenticate, loadRecoveryServers, RecoveryError, type RecoveryServer } from '@/lib/recovery';
import type { NetConfig } from '@/lib/stellar';

/** K = a XOR b. `a` is fresh randomness, so each half alone is uniformly random. */
export function splitKey(key: Uint8Array): [Uint8Array, Uint8Array] {
  if (key.length !== BACKUP_RECOVERY_KEY_BYTES) throw new Error('a recovery key is 32 bytes');
  const a = crypto.getRandomValues(new Uint8Array(BACKUP_RECOVERY_KEY_BYTES));
  const b = key.map((byte, i) => byte ^ a[i]);
  return [a, b];
}

export function joinKey(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== BACKUP_RECOVERY_KEY_BYTES || b.length !== BACKUP_RECOVERY_KEY_BYTES) {
    throw new RecoveryError('recovery.error.badShare');
  }
  return a.map((byte, i) => byte ^ b[i]);
}

/** A fresh recovery key. Sealed into a box only once its halves are filed. */
export function newRecoveryKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(BACKUP_RECOVERY_KEY_BYTES));
}

/**
 * File the halves of `key` for `address` — one per server, each under that server's own
 * SEP-10 token of the account — replacing any halves filed before.
 *
 * Call it BEFORE the box sealed with `key` is uploaded, and upload that box only if it
 * resolved: a box behind a key the servers do not hold halves of is a door that opens
 * nothing. If the second server refuses, the first half is orphaned — harmless, it opens
 * nothing alone and the next filing replaces it — and this throws.
 */
export async function fileBackupRecovery(
  cfg: NetConfig,
  secret: string,
  address: string,
  email: string,
  key: Uint8Array,
): Promise<void> {
  const servers = await loadRecoveryServers(cfg);
  const halves = splitKey(key);
  try {
    for (const [i, server] of servers.entries()) {
      const token = await authenticate(cfg, server, address, secret);
      await recoveryShareFile(server.sep30Base, token, address, toBase64(halves[i]), email.trim().toLowerCase());
    }
  } finally {
    halves.forEach((h) => h.fill(0));
  }
}

/**
 * The recovery key for `address`, from both servers, with the identity tokens the recovery
 * screen proved (one per server, in role order). Null when either server holds no half for
 * this inbox — the backup has no email door, or it was filed under another email.
 */
export async function takeBackupRecovery(
  servers: readonly RecoveryServer[],
  tokens: readonly string[],
  address: string,
): Promise<Uint8Array | null> {
  const halves: Uint8Array[] = [];
  try {
    for (const [i, server] of servers.entries()) {
      halves.push(fromBase64(await recoveryShareTake(server.sep30Base, tokens[i], address)));
    }
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
  const key = joinKey(halves[0], halves[1]);
  halves.forEach((h) => h.fill(0));
  return key;
}
