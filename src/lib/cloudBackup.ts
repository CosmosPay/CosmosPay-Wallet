/**
 * The cloud backup: this wallet's seed, sealed on the device under the person's password,
 * kept by the community server, and handed back after a sign-in on the next device.
 *
 * The server stores the box and cannot open it. What stands between a leaked copy of its
 * table and the funds is exactly two things, both decided here: the password, and
 * `BACKUP_PBKDF2_ITERATIONS` — higher than the local vault's cost because the reader of a
 * leaked table gets unlimited offline guesses at every box in it. `sealForBackup` owns that
 * number so no caller can lower it.
 *
 * Opening checks the result against the address the server filed the box under. The box
 * is authenticated (AES-GCM), so a server cannot forge one — but it can hand back SOMEONE
 * ELSE'S genuine box, and a password that happens to open it would otherwise restore a
 * wallet the person never had. `BackupMismatchError` refuses that instead.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { open, sealForBackup, type SealedBox } from '@/lib/crypto';
import { tNow } from '@/lib/i18n';
import type { VaultSecret } from '@/lib/vault';

/** The box opened, but it is not the wallet it was filed as. Never a wrong password. */
export class BackupMismatchError extends Error {
  constructor() {
    super(tNow('backup.mismatch'));
    this.name = 'BackupMismatchError';
  }
}

/** The server returned something that is not a box this wallet writes. */
export class BackupUnreadableError extends Error {
  constructor() {
    super(tNow('backup.unreadable'));
    this.name = 'BackupUnreadableError';
  }
}

/**
 * Seal a wallet's secret for the server to keep. Returns the box as the JSON it stores.
 *
 * `account` is only passed by a RECOVERED wallet, whose address is no longer its key's own
 * — SEP-30 recovery retires the master key and puts a new one on the account. It travels
 * INSIDE the ciphertext rather than beside it: the server files a box under an address
 * it is told, and a box that carried its own address in the clear would be telling the
 * server something it already knows while telling anyone who reads the row something
 * they should not.
 */
export async function sealBackup(secret: VaultSecret, password: string, account?: string): Promise<string> {
  const payload = account ? { ...secret, account } : secret;
  return JSON.stringify(await sealForBackup(JSON.stringify(payload), password));
}

/** Parse the stored JSON back into a box, refusing anything that is not one. */
function parseBox(box: string): SealedBox {
  let b: Partial<SealedBox>;
  try {
    b = JSON.parse(box) as Partial<SealedBox>;
  } catch {
    throw new BackupUnreadableError();
  }
  if (!b || b.v !== 2 || typeof b.salt !== 'string' || typeof b.iv !== 'string' || typeof b.data !== 'string') {
    throw new BackupUnreadableError();
  }
  return b as SealedBox;
}

/**
 * Open a backup with the password it was sealed under.
 *
 * Throws `WrongPasswordError` (from `lib/crypto`) when the password is wrong — the one
 * failure a caller should count as a guess — and `BackupMismatchError` /
 * `BackupUnreadableError` for everything that is not the person's fault.
 */
export async function openBackup(
  box: string,
  password: string,
  expectedAddress: string,
): Promise<VaultSecret & { account?: string }> {
  const plain = await open(parseBox(box), password);
  let secret: VaultSecret & { account?: string };
  try {
    secret = JSON.parse(plain) as VaultSecret & { account?: string };
  } catch {
    throw new BackupUnreadableError();
  }
  if (typeof secret?.secret !== 'string') throw new BackupUnreadableError();
  let address: string;
  try {
    // The account a RECOVERED wallet recorded when it sealed this, falling back to the
    // key's own address — which is what every wallet that has not been recovered is. The
    // fallback is not a loosening: a box with no `account` is one whose key IS its address,
    // and a box that names one is checked against that name just as strictly.
    address = typeof secret.account === 'string' ? secret.account : Keypair.fromSecret(secret.secret).publicKey();
  } catch {
    throw new BackupUnreadableError();
  }
  if (address !== expectedAddress) throw new BackupMismatchError();
  return {
    secret: secret.secret,
    mnemonic: typeof secret.mnemonic === 'string' ? secret.mnemonic : null,
    ...(typeof secret.account === 'string' ? { account: secret.account } : {}),
  };
}
