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
import { BACKUP_RECOVERY_KEY_BYTES, RECOVERY_LIST_MAX_PAGES } from '@/constants/recovery';
import { recoveryShareFile, recoveryShares, type SignInReady, type StoredBackup } from '@/lib/cosmospay';
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
 * Every half one server holds for the proven inbox, following its cursor to the end.
 *
 * Reading one page would bring back some of a person's wallets and leave the rest behind a
 * password they no longer have — with nothing on screen to say any were missed. The walk
 * stops on the same three terms as the SEP-30 listing in `lib/recovery.ts`: an empty page,
 * a page that adds nothing new, and `RECOVERY_LIST_MAX_PAGES`.
 */
async function allSharesOf(server: RecoveryServer, token: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  let after: string | undefined;
  for (let page = 0; page < RECOVERY_LIST_MAX_PAGES; page++) {
    const { shares } = await recoveryShares(server.sep30Base, token, after);
    if (!shares.length) break;
    const before = seen.size;
    for (const s of shares) if (!seen.has(s.address)) seen.set(s.address, s.share);
    if (seen.size === before) break; // the same page again: the cursor is not moving
    after = shares[shares.length - 1].address;
  }
  return seen;
}

/**
 * Join two servers' listings into one key per address. Only an address BOTH listed gets
 * one: a single half is random noise, and offering its backup would be a door that opens
 * nothing. A half of the wrong length is dropped for that address alone rather than
 * failing the rest — it is a key this wallet never filed, and the others are still good.
 */
export function joinShares(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const [address, shareA] of a) {
    const shareB = b.get(address);
    if (shareB === undefined) continue;
    const halves = [fromBase64(shareA), fromBase64(shareB)];
    try {
      keys.set(address, joinKey(halves[0], halves[1]));
    } catch {
      // Not a half this wallet wrote: that backup keeps its other doors, nothing more.
    } finally {
      halves.forEach((h) => h.fill(0));
    }
  }
  return keys;
}

/**
 * The Stellar backups a sign-in brought back, newest first. `backups` is absent from a
 * server older than per-wallet backups, where `backup` is the only one. Other chains'
 * boxes are left out: this wallet keeps none of its own — those addresses come back with
 * the phrase (`lib/chainAddresses.ts`).
 */
export function signInBackups(ready: Pick<SignInReady, 'backup' | 'backups'>): StoredBackup[] {
  const all = ready.backups ?? (ready.backup ? [ready.backup] : []);
  return all.filter((b) => (b.chain ?? 'stellar') === 'stellar');
}

/**
 * Which wallet an email recovery lands in, and which keys are worth keeping.
 *
 * Keys for an address with no box among `backups` are zeroed and DROPPED from `keys`: a
 * half filed for a wallet whose backup is gone opens nothing, and keeping it would only be
 * keeping a key. Of the rest, the newest backup with a key is the one the person lands in —
 * not necessarily the newest backup, which may predate the door while an older one has it.
 * Null when no backup this account holds has a key.
 */
export function pickRecoveryPrimary(
  backups: readonly Pick<StoredBackup, 'stellarAddress'>[],
  keys: Map<string, Uint8Array>,
): string | null {
  const held = new Set(backups.map((b) => b.stellarAddress));
  for (const [address, key] of keys) {
    if (held.has(address)) continue;
    key.fill(0);
    keys.delete(address);
  }
  return backups.find((b) => keys.has(b.stellarAddress))?.stellarAddress ?? null;
}

/**
 * The recovery key of EVERY backup filed under the inbox the recovery screen proved, keyed
 * by address, with the identity tokens it holds (one per server, in role order).
 *
 * One proof per server, however many wallets the person backed up: forgetting the password
 * forgets it for all of them, so recovering one and leaving the rest sealed under it was a
 * recovery that lost wallets. Empty when neither server holds a half for this inbox.
 */
export async function takeAllBackupRecovery(
  servers: readonly RecoveryServer[],
  tokens: readonly string[],
): Promise<Map<string, Uint8Array>> {
  if (servers.length !== 2) throw new RecoveryError('recovery.error.generic');
  const [a, b] = await Promise.all(servers.map((s, i) => allSharesOf(s, tokens[i])));
  return joinShares(a, b);
}
