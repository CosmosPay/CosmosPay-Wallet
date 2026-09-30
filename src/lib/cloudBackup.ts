/**
 * The cloud backup: this wallet's seed, sealed on the device, kept by the community server,
 * and handed back after a sign-in on the next device.
 *
 * The server stores the box and cannot open it. What stands between a leaked copy of its
 * table and the funds is decided here, and it depends on the door:
 *
 *  - a PASSWORD door: the password, and the Argon2id cost `BACKUP_ARGON2` — memory-hard,
 *    because the reader of a leaked table gets unlimited offline guesses at every box in
 *    it. `sealBackup` owns those numbers so no caller can lower them.
 *  - a PASSKEY door: 32 bytes of PRF output that only the person's authenticator can
 *    produce (`lib/passkey.ts`). Nothing to guess offline, so nothing to stretch.
 *  - a RECOVERY door (v4 only, at most one, never alone): a random 32-byte key split in
 *    two between the recovery servers (`lib/backupRecovery.ts`). It is how a person who
 *    forgot the password — and has no passkey there — gets the whole wallet back by
 *    proving their email to both servers, and then sets a new password
 *    (`resetBackupPassword`). Either server alone holds random noise.
 *
 * THREE SHAPES, ONE WRITTEN. `v: 4` is what every backup is sealed as now: the seed under a
 * random DATA key, that key sealed once per door in `slots`, and a password door derived
 * with Argon2id (`BACKUP_ARGON2`) — memory-hard, so a leaked table costs a GPU per guess
 * what it costs the phone. `v: 2` (the seed straight under a PBKDF2 password) and `v: 3`
 * (the slot shape with a PBKDF2 password door) are still OPENED, because the server holds
 * boxes written before; `backupNeedsUpgrade` says when a restore should re-seal one. The
 * community server's `isBackupBox` validates all three and holds each password door to its
 * own floor.
 *
 * Opening checks the result against the address the server filed the box under. The box
 * is authenticated (AES-GCM), so a server cannot forge one — but it can hand back SOMEONE
 * ELSE'S genuine box, and a secret that happens to open it would otherwise restore a
 * wallet the person never had. `BackupMismatchError` refuses that instead.
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  deriveArgon2Key,
  derivePasswordKey,
  newRandomKey,
  open,
  openBytes,
  sealBytes,
  toBase64,
  WrongPasswordError,
  type SealedBox,
  type SealedBytes,
} from '@/lib/crypto';
import { tNow } from '@/lib/i18n';
import type { VaultSecret } from '@/lib/vault';
import { BACKUP_ARGON2, SALT_BYTES } from '@/constants/crypto';

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

/**
 * The recovered key does not open this box: it has no recovery door, or the halves the
 * servers returned are from an earlier seal. Nobody typed anything, so it is not a guess.
 */
export class BackupRecoveryError extends Error {
  constructor() {
    super(tNow('backup.recoveryMismatch'));
    this.name = 'BackupRecoveryError';
  }
}

/** A passkey door: the credential it is filed under and the PRF secret that opens it. */
export interface PasskeyDoor {
  id: string;
  secret: Uint8Array;
}

/** The doors to seal a new box behind. A password or a passkey; `recovery` only beside one. */
export interface BackupDoors {
  password?: string;
  passkey?: PasskeyDoor;
  /** The whole key the recovery servers hold the halves of. */
  recovery?: Uint8Array;
}

/** What opens a box: a typed password, a passkey's secret, or the recovered key. */
export type BackupKey = string | { passkey: PasskeyDoor } | { recovery: Uint8Array };

/** A v3 password door: PBKDF2. Only ever opened now. */
interface Pbkdf2Slot extends SealedBytes {
  kind: 'password';
  salt: string;
  iter: number;
}

/** A v4 password door: Argon2id, with its parameters beside it (they sit outside the AEAD). */
interface Argon2Slot extends SealedBytes {
  kind: 'password';
  kdf: 'argon2id';
  salt: string;
  m: number;
  t: number;
  p: number;
}

type PasswordSlot = Pbkdf2Slot | Argon2Slot;

interface PasskeySlot extends SealedBytes {
  kind: 'passkey';
  id: string;
}

/** The email-recovery door: the data key under the key the two recovery servers split. */
interface RecoverySlot extends SealedBytes {
  kind: 'recovery';
}

type Slot = PasswordSlot | PasskeySlot | RecoverySlot;

/** The slot-shaped box: `v: 3` has PBKDF2 password doors, `v: 4` Argon2id ones. */
interface BoxV3 extends SealedBytes {
  v: 3 | 4;
  slots: Slot[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* --------------------------------- sealing -------------------------------- */

/**
 * Seal a wallet's secret for the server to keep. Returns the box as the JSON it stores.
 *
 * Always a `v: 4` box, with one slot per door: a bare password string is a password door and
 * nothing else. The password door is Argon2id; a passkey door is the authenticator's PRF
 * output, which needs no stretching.
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
  if (typeof doors === 'string') doors = { password: doors };
  if (!doors.password && !doors.passkey) throw new Error('a backup needs at least one door');

  const dataKey = newRandomKey();
  try {
    const slots: Slot[] = [];
    if (doors.password) {
      const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
      const params = { salt, ...BACKUP_ARGON2 };
      const key = await deriveArgon2Key(doors.password, params);
      slots.push({ kind: 'password', kdf: 'argon2id', ...params, ...(await sealBytes(dataKey, key)) });
      key.fill(0);
    }
    if (doors.passkey) {
      slots.push({ kind: 'passkey', id: doors.passkey.id, ...(await sealBytes(dataKey, doors.passkey.secret)) });
    }
    if (doors.recovery) slots.push({ kind: 'recovery', ...(await sealBytes(dataKey, doors.recovery)) });
    const box: BoxV3 = { v: 4, ...(await sealBytes(enc.encode(payload), dataKey)), slots };
    return JSON.stringify(box);
  } finally {
    dataKey.fill(0);
  }
}

/* --------------------------------- parsing -------------------------------- */

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseSlot(s: unknown, v: 3 | 4): Slot | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (!isStr(o.iv) || !isStr(o.data)) return null;
  // Each version has exactly one kind of password door: a v4 box never carries PBKDF2.
  if (v === 3 && o.kind === 'password' && isStr(o.salt) && Number.isInteger(o.iter)) {
    return { kind: 'password', salt: o.salt, iter: o.iter as number, iv: o.iv, data: o.data };
  }
  if (
    v === 4 &&
    o.kind === 'password' &&
    o.kdf === 'argon2id' &&
    isStr(o.salt) &&
    [o.m, o.t, o.p].every((n) => Number.isInteger(n))
  ) {
    return { kind: 'password', kdf: 'argon2id', salt: o.salt, m: o.m as number, t: o.t as number, p: o.p as number, iv: o.iv, data: o.data };
  }
  if (o.kind === 'passkey' && isStr(o.id)) return { kind: 'passkey', id: o.id, iv: o.iv, data: o.data };
  if (v === 4 && o.kind === 'recovery') return { kind: 'recovery', iv: o.iv, data: o.data };
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
  if ((b.v === 3 || b.v === 4) && isStr(b.iv) && isStr(b.data) && Array.isArray(b.slots) && b.slots.length > 0) {
    const v = b.v;
    const slots = b.slots.map((slot) => parseSlot(slot, v));
    if (slots.every((s): s is Slot => s !== null)) return { v, iv: b.iv, data: b.data, slots };
  }
  throw new BackupUnreadableError();
}

/**
 * Which doors a box has, for the screen to offer the right one: a passkey button when the
 * box has a passkey door, a password field when it has a password door. A `v: 2` box is a
 * password door and nothing else.
 */
export function backupDoors(box: string): { password: boolean; passkeys: string[]; recovery: boolean } {
  const b = parseBox(box);
  if (!('slots' in b)) return { password: true, passkeys: [], recovery: false };
  return {
    password: b.slots.some((s) => s.kind === 'password'),
    passkeys: b.slots.flatMap((s) => (s.kind === 'passkey' ? [s.id] : [])),
    recovery: b.slots.some((s) => s.kind === 'recovery'),
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
      const k =
        'kdf' in door
          ? await deriveArgon2Key(key, { salt: door.salt, m: door.m, t: door.t, p: door.p })
          : await derivePasswordKey(key, { salt: door.salt, iter: door.iter });
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
  if ('recovery' in key) {
    const door = box.slots.find((s): s is RecoverySlot => s.kind === 'recovery');
    if (!door) throw new BackupRecoveryError();
    try {
      return await openBytes(door, key.recovery);
    } catch (e) {
      throw e instanceof WrongPasswordError ? new BackupRecoveryError() : e;
    }
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
  if (!('slots' in b)) {
    // A v2 box has one door and it is a password. A passkey here is not a guess.
    if (typeof key !== 'string') throw 'recovery' in key ? new BackupRecoveryError() : new BackupPasskeyError();
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
 * Whether a restore that just opened this box with the password should re-seal it as `v: 4`.
 *
 * Only a box older than v4 whose every door is a password: re-sealing needs a secret for
 * every door, and a restore with the password cannot reproduce a passkey door — upgrading
 * that box would silently remove the way in its owner set up.
 */
export function backupNeedsUpgrade(box: string): boolean {
  const b = parseBox(box);
  if ('slots' in b && b.v === 4) return false;
  return backupDoors(box).passkeys.length === 0;
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

/* ------------------------------ changing doors ----------------------------- */

/** The v4 box a door change starts from: its data key, opened with `key`. */
async function reopen(box: string, key: BackupKey): Promise<{ box: BoxV3; dataKey: Uint8Array }> {
  const b = parseBox(box);
  // A door is added to the slot shape only; an older box is re-sealed on restore first.
  if (!('slots' in b) || b.v !== 4) throw new BackupUnreadableError();
  return { box: b, dataKey: await dataKeyOf(b, key) };
}

/**
 * Give a box a recovery door, keeping every door it has.
 *
 * Opened with a door the caller holds (the password or passkey that just restored it), so
 * the seed is never re-sealed: the same data key gains one more slot, and a passkey door
 * filed by another device survives — which re-sealing from scratch could not promise. A
 * recovery door already there is replaced: the servers hold the halves of ONE key.
 */
export async function addRecoveryDoor(box: string, key: BackupKey, recovery: Uint8Array): Promise<string> {
  const { box: b, dataKey } = await reopen(box, key);
  try {
    const slots: Slot[] = [...b.slots.filter((s) => s.kind !== 'recovery'), { kind: 'recovery', ...(await sealBytes(dataKey, recovery)) }];
    return JSON.stringify({ ...b, slots });
  } finally {
    dataKey.fill(0);
  }
}

/**
 * After an email recovery: open the box with the recovered key and put a NEW password
 * door where the forgotten one was. Passkey doors stay, and so does the recovery door —
 * the halves the servers hold still open it, so it keeps working for the next time.
 */
export async function resetBackupPassword(box: string, recovery: Uint8Array, password: string): Promise<string> {
  const { box: b, dataKey } = await reopen(box, { recovery });
  try {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
    const params = { salt, ...BACKUP_ARGON2 };
    const key = await deriveArgon2Key(password, params);
    const door: Argon2Slot = { kind: 'password', kdf: 'argon2id', ...params, ...(await sealBytes(dataKey, key)) };
    key.fill(0);
    return JSON.stringify({ ...b, slots: [door, ...b.slots.filter((s) => s.kind !== 'password')] });
  } finally {
    dataKey.fill(0);
  }
}
