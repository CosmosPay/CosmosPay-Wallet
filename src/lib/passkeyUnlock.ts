/**
 * Opening this device's wallets with a passkey instead of a typed password.
 *
 * WHAT IS SEALED IS A GENERATED PASSWORD, and that is the whole design. A device protected
 * by a passkey still runs the vault exactly as every other device does — one app password,
 * one `VaultKey` derived from it, `convergeSeals`, the attempt ladder, `changePassword` —
 * except that its app password is 32 random bytes nobody ever sees (`newDevicePassword`).
 * This file keeps that password sealed under the passkey's UNLOCK secret
 * (`lib/passkey.ts`), so a fingerprint produces it and every path that needs "the password"
 * gets it from there instead of the keyboard. Nothing downstream had to learn a second way
 * in, which is what keeps this from being a second, less-audited vault.
 *
 * WHY THIS MAY STORE A PASSWORD WHEN `lib/deviceAuth.ts` MAY NOT. The rule there — never
 * keep the app password, keep the key it derives — exists because a human password is very
 * likely reused on other services, so a leak of it hurts beyond this wallet. A generated one
 * is used nowhere else and opens nothing but this device's vault, which is exactly what the
 * `VaultKey` the other door keeps would open. Keeping the password rather than the key is
 * also what lets the rest of the app stay password-shaped (`unlock`, `checkPassword`,
 * `revealBackup`, the dapp approval window), each of which would otherwise need a key-shaped
 * twin.
 *
 * WHAT THE PERSON GIVES UP. There is no password to fall back on: lose the passkey AND this
 * device's files and the vault here is gone. The wallet is not — the cloud backup has its own
 * passkey door (and a password door when the person had one), and SEP-30 recovery replaces
 * the key outright. The screens that turn this on say so.
 *
 *   cosmos.passkey -> { v: 1, id, box: SealedBox(device password) }   normal storage
 *
 * The box is sealed with `sealUnderWrapKey`, whose key is the 32-byte PRF output: full
 * entropy, so there is nothing to stretch and the envelope opens in microseconds once the
 * authenticator has answered.
 */
import { openUnderWrapKey, sealUnderWrapKey, toBase64, WrongPasswordError, type SealedBox } from '@/lib/crypto';
import { getPasskeySecrets, passkeyPossible, type CredentialsApi, type PasskeySecrets } from '@/lib/passkey';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';
import { DEVICE_PASSWORD_BYTES, PASSKEY_UNLOCK_STORAGE_KEY } from '@/constants/passkey';

interface Envelope {
  v: 1;
  /** base64url credential id — the only passkey this device asks for. */
  id: string;
  box: SealedBox;
}

/**
 * The passkey answered, but it cannot open this device's door: another passkey, or an
 * envelope from before the device password last changed. Never a wrong password — there
 * is no password in this flow — so the attempt ladder must not count it.
 */
export class PasskeyUnlockStaleError extends Error {
  constructor() {
    super('This passkey does not open this device.');
    this.name = 'PasskeyUnlockStaleError';
  }
}

/** A fresh app password for a passkey-protected device. Never shown, never typed. */
export function newDevicePassword(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(DEVICE_PASSWORD_BYTES)));
}

/** The envelope, or null when there is none or it is not one this build writes. */
function readEnvelope(raw: string | null): Envelope | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Partial<Envelope>;
    if (e?.v !== 1 || typeof e.id !== 'string' || !e.id || !e.box || typeof e.box !== 'object') return null;
    return e as Envelope;
  } catch {
    return null;
  }
}

/** Exported for tests: the fail-closed parse, pure over a string. */
export const parsePasskeyEnvelope = readEnvelope;

/**
 * Is this device protected by a passkey, and which one? Null on a password device, and on
 * any build that cannot run a passkey ceremony — an envelope it cannot open is not a door.
 */
export async function passkeyUnlockCredential(): Promise<string | null> {
  if (!passkeyPossible()) return null;
  return readEnvelope(await storageGet(PASSKEY_UNLOCK_STORAGE_KEY))?.id ?? null;
}

/**
 * Seal the device password under a passkey's unlock secret.
 *
 * `devicePassword` must be the one the vault is ACTUALLY sealed under — the caller writes
 * this only after the vault change that installed it has committed, for the reason
 * `enableDeviceAuth` gives about proven keys: an envelope that opens nothing is a failure
 * that arrives on the unlock screen, later, with nothing to say why.
 */
export async function enrolPasskeyUnlock(secrets: PasskeySecrets, devicePassword: string): Promise<void> {
  const env: Envelope = {
    v: 1,
    id: secrets.credentialId,
    box: await sealUnderWrapKey(devicePassword, toBase64(secrets.unlock)),
  };
  await storageSet(PASSKEY_UNLOCK_STORAGE_KEY, JSON.stringify(env));
}

/**
 * The device password, from secrets a ceremony already produced.
 *
 * Split from the ceremony so ONE fingerprint can serve two purposes — a password change
 * that re-seals the backup needs the backup secret and the device password together.
 */
export async function devicePasswordFrom(secrets: PasskeySecrets): Promise<string> {
  const env = readEnvelope(await storageGet(PASSKEY_UNLOCK_STORAGE_KEY));
  if (!env || env.id !== secrets.credentialId) throw new PasskeyUnlockStaleError();
  try {
    return await openUnderWrapKey(env.box, toBase64(secrets.unlock));
  } catch (e) {
    if (e instanceof WrongPasswordError) throw new PasskeyUnlockStaleError();
    throw e;
  }
}

/**
 * Ask this device's passkey for the device password. One OS sheet.
 *
 * Returns the secrets too, so a caller that also needs the BACKUP secret — re-sealing the
 * cloud backup — does not raise a second sheet for it. The caller wipes them.
 */
export async function unlockWithPasskey(
  api?: CredentialsApi,
): Promise<{ password: string; secrets: PasskeySecrets }> {
  const id = await passkeyUnlockCredential();
  if (!id) throw new PasskeyUnlockStaleError();
  const secrets = await getPasskeySecrets([id], api);
  return { password: await devicePasswordFrom(secrets), secrets };
}

/** Turn the passkey door off. The caller has already moved the vault onto a typed password. */
export async function dropPasskeyUnlock(): Promise<void> {
  await storageRemove(PASSKEY_UNLOCK_STORAGE_KEY);
}

