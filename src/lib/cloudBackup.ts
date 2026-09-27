/**
 * The cloud backup: this wallet's seed, sealed on the device, kept by the community server,
 * and handed back after a sign-in on the next device.
 *
 * The server stores the box and cannot open it. What stands between a leaked copy of its
 * table and the funds is decided here, and it depends on the door:
 *
 *  - a PASSWORD door: the password, and `BACKUP_PBKDF2_ITERATIONS` — higher than the local
 *    vault's cost because the reader of a leaked table gets unlimited offline guesses at
 *    every box in it. `sealBackup` owns that number so no caller can lower it.
 *  - a PASSKEY door: 32 bytes of PRF output that only the person's authenticator can
 *    produce (`lib/passkey.ts`). Nothing to guess offline, so nothing to stretch.
 *
 * TWO SHAPES. `v: 2` is the seed sealed straight under a password — what every wallet wrote
 * before passkeys, and still what a password-only backup is, so a server that does not know
 * `v: 3` keeps accepting it. `v: 3` seals the seed under a random DATA key and seals that
 * key once per door in `slots`; it is written whenever a passkey is involved. The community
 * server's `isBackupBox` validates both, and holds every password door to the same floor.
 *
 * Opening checks the result against the address the server filed the box under. The box
 * is authenticated (AES-GCM), so a server cannot forge one — but it can hand back SOMEONE
 * ELSE'S genuine box, and a secret that happens to open it would otherwise restore a
 * wallet the person never had. `BackupMismatchError` refuses that instead.
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  derivePasswordKey,
  newRandomKey,
  open,
  openBytes,
  sealBytes,
  sealForBackup,
  toBase64,
  WrongPasswordError,
  type SealedBox,
  type SealedBytes,
} from '@/lib/crypto';
import { tNow } from '@/lib/i18n';
import type { VaultSecret } from '@/lib/vault';
import { BACKUP_PBKDF2_ITERATIONS, SALT_BYTES } from '@/constants/crypto';

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
 * The passkey that answered is not one of this box's doors, or its secret does not open the
 * door filed under its id. Not a guess — nobody typed anything — so the attempt ladder must
 * not count it, and not a damaged box either: another passkey may well open it.
 */
export class BackupPasskeyError extends Error {
  constructor() {
    super(tNow('backup.passkeyMismatch'));
    this.name = 'BackupPasskeyError';
  }
}

/** A passkey door: the credential it is filed under and the PRF secret that opens it. */
export interface PasskeyDoor {
  id: string;
  secret: Uint8Array;
}

/** The doors to seal a new box behind. At least one. */
export interface BackupDoors {
  password?: string;
  passkey?: PasskeyDoor;
}

/** What opens a box: a typed password, or a passkey's secret. */
export type BackupKey = string | { passkey: PasskeyDoor };

interface PasswordSlot extends SealedBytes {
  kind: 'password';
  salt: string;
  iter: number;
}

interface PasskeySlot extends SealedBytes {
  kind: 'passkey';
  id: string;
}

type Slot = PasswordSlot | PasskeySlot;

interface BoxV3 extends SealedBytes {
  v: 3;
  slots: Slot[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* --------------------------------- sealing -------------------------------- */

/**
 * Seal a wallet's secret for the server to keep. Returns the box as the JSON it stores.
 *
 * A bare password string seals a `v: 2` box, exactly as before passkeys. Doors seal a
 * `v: 3` box with one slot per door — which is what a passkey needs, and what lets a person
 * keep their password as a second way in.
 *
 * `account` is only passed by a RECOVERED wallet, whose address is no longer its key's own
 * — SEP-30 recovery retires the master key and puts a new one on the account. It travels
 * INSIDE the ciphertext rather than beside it: the server files a box under an address
 * it is told, and a box that carried its own address in the clear would be telling the
 * server something it already knows while telling anyone who reads the row something
 * they should not.
 */
export async function sealBackup(secret: VaultSecret, doors: string | BackupDoors, account?: string): Promise<string> {
  const payload = JSON.stringify(account ? { ...secret, account } : secret);
  if (typeof doors === 'string') return JSON.stringify(await sealForBackup(payload, doors));
  if (!doors.password && !doors.passkey) throw new Error('a backup needs at least one door');

  const dataKey = newRandomKey();
  try {
    const slots: Slot[] = [];
    if (doors.password) {
      const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
      const iter = BACKUP_PBKDF2_ITERATIONS;
      const key = await derivePasswordKey(doors.password, { salt, iter });
      slots.push({ kind: 'password', salt, iter, ...(await sealBytes(dataKey, key)) });
      key.fill(0);
    }
    if (doors.passkey) {
      slots.push({ kind: 'passkey', id: doors.passkey.id, ...(await sealBytes(dataKey, doors.passkey.secret)) });
    }
    const box: BoxV3 = { v: 3, ...(await sealBytes(enc.encode(payload), dataKey)), slots };
    return JSON.stringify(box);
  } finally {
    dataKey.fill(0);
  }
}

/* --------------------------------- parsing -------------------------------- */

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseSlot(s: unknown): Slot | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (!isStr(o.iv) || !isStr(o.data)) return null;
  if (o.kind === 'password' && isStr(o.salt) && Number.isInteger(o.iter)) {
    return { kind: 'password', salt: o.salt, iter: o.iter as number, iv: o.iv, data: o.data };
  }
  if (o.kind === 'passkey' && isStr(o.id)) return { kind: 'passkey', id: o.id, iv: o.iv, data: o.data };
  return null;
}

/** Parse the stored JSON back into a box of either shape, refusing anything else. */
function parseBox(box: string): SealedBox | BoxV3 {
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(box) as Record<string, unknown>;
  } catch {
    throw new BackupUnreadableError();
  }
  if (!b || typeof b !== 'object') throw new BackupUnreadableError();
  if (b.v === 2 && isStr(b.salt) && isStr(b.iv) && isStr(b.data)) return b as unknown as SealedBox;
  if (b.v === 3 && isStr(b.iv) && isStr(b.data) && Array.isArray(b.slots) && b.slots.length > 0) {
    const slots = b.slots.map(parseSlot);
    if (slots.every((s): s is Slot => s !== null)) return { v: 3, iv: b.iv, data: b.data, slots };
  }
  throw new BackupUnreadableError();
}

/**
 * Which doors a box has, for the screen to offer the right one: a passkey button when the
 * box has a passkey door, a password field when it has a password door. A `v: 2` box is a
 * password door and nothing else.
 */
export function backupDoors(box: string): { password: boolean; passkeys: string[] } {
  const b = parseBox(box);
  if (b.v !== 3) return { password: true, passkeys: [] };
  return {
    password: b.slots.some((s) => s.kind === 'password'),
    passkeys: b.slots.flatMap((s) => (s.kind === 'passkey' ? [s.id] : [])),
  };
}

/* --------------------------------- opening -------------------------------- */

/**
 * The data key behind a v3 box's doors.
 *
 * A password is tried against every password door; a wrong one is `WrongPasswordError`, the
 * one failure a caller counts as a guess. A passkey opens only the door filed under its
 * own credential id, and anything short of that is `BackupPasskeyError`.
 */
async function dataKeyOf(box: BoxV3, key: BackupKey): Promise<Uint8Array> {
  if (typeof key === 'string') {
    const doors = box.slots.filter((s): s is PasswordSlot => s.kind === 'password');
    if (!doors.length) throw new WrongPasswordError();
    for (const door of doors) {
      const k = await derivePasswordKey(key, { salt: door.salt, iter: door.iter });
      try {
        return await openBytes(door, k);
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
      } finally {
        k.fill(0);
      }
    }
    throw new WrongPasswordError();
  }
  const door = box.slots.find((s): s is PasskeySlot => s.kind === 'passkey' && s.id === key.passkey.id);
  if (!door) throw new BackupPasskeyError();
  try {
    return await openBytes(door, key.passkey.secret);
  } catch (e) {
    throw e instanceof WrongPasswordError ? new BackupPasskeyError() : e;
  }
}

async function plaintextOf(b: SealedBox | BoxV3, key: BackupKey): Promise<string> {
  if (b.v !== 3) {
    // A v2 box has one door and it is a password. A passkey here is not a guess.
    if (typeof key !== 'string') throw new BackupPasskeyError();
    return open(b, key);
  }
  const dataKey = await dataKeyOf(b, key);
  try {
    // The payload's own tag failing under a data key a door DID release is a damaged box,
    // not a wrong secret: the door already proved the secret.
    return dec.decode(await openBytes(b, dataKey).catch(() => Promise.reject(new BackupUnreadableError())));
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Open a backup with a password or a passkey's secret.
 *
 * Throws `WrongPasswordError` (from `lib/crypto`) when a password is wrong — the one
 * failure a caller should count as a guess — `BackupPasskeyError` when the passkey is not
 * one of this box's doors, and `BackupMismatchError` / `BackupUnreadableError` for
 * everything that is not the person's fault.
 */
export async function openBackup(
  box: string,
  key: BackupKey,
  expectedAddress: string,
): Promise<VaultSecret & { account?: string }> {
  const plain = await plaintextOf(parseBox(box), key);
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
