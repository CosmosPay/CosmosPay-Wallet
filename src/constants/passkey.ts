/**
 * Passkeys — the numbers and labels behind `lib/passkey.ts`, `lib/passkeyUnlock.ts` and the
 * passkey doors of the cloud backup (`lib/cloudBackup.ts`).
 *
 * A passkey never hands the wallet a key of its own. What the wallet uses is the WebAuthn
 * PRF extension: the authenticator mixes a salt the wallet chooses with a secret that never
 * leaves it, and returns 32 bytes that are the same every time for that (credential, salt)
 * pair. Two salts, so one fingerprint yields two unrelated secrets — one that opens the
 * backup the server keeps, one that opens this device's vault — and neither can be derived
 * from the other.
 */
import type { PasskeyFailure } from '@/lib/passkey';

/** What the OS sheet names as the site the passkey belongs to. Not an identifier. */
export const PASSKEY_RP_NAME = 'Cosmos Wallet';

/**
 * The PRF salt labels. Hashed with SHA-256 into the 32-byte salts the extension takes.
 *
 * NEVER CHANGE THESE. A passkey's PRF output is a function of the salt, so a new label is a
 * new secret: every backup door and every device door written under the old one would stop
 * opening, and there is no way to derive the old output from the new one. A rotation means
 * a new label AND a migration that asks the authenticator for both.
 */
export const PASSKEY_PRF_BACKUP_LABEL = 'cosmos-wallet/backup/v1';
export const PASSKEY_PRF_UNLOCK_LABEL = 'cosmos-wallet/unlock/v1';

/**
 * How long the OS sheet may stay up. Two minutes: long enough to fetch a phone for a
 * cross-device passkey (the QR code path), short enough that a forgotten sheet does not
 * outlive the session that raised it by much. The session epoch guards the rest.
 */
export const PASSKEY_TIMEOUT_MS = 120_000;

/** Bytes of the random user handle a new passkey is filed under. WebAuthn allows up to 64. */
export const PASSKEY_USER_ID_BYTES = 16;

/** What PRF returns, and what both doors are keyed with. */
export const PASSKEY_SECRET_BYTES = 32;

/**
 * Where this device's passkey door lives. ONE per device, not per wallet: what it seals is
 * the device's app password, and there is one of those for every wallet on the device.
 */
export const PASSKEY_UNLOCK_STORAGE_KEY = 'cosmos.passkey';

/**
 * Bytes of the generated app password a passkey-protected device runs on. It is never
 * shown, never typed and never leaves this device — see `lib/passkeyUnlock.ts`.
 */
export const DEVICE_PASSWORD_BYTES = 32;

/**
 * The line each ceremony failure shows. i18n KEYS, not copy — `constants/` cannot call the
 * translator. `cancelled` maps to nothing a screen shows: dismissing the sheet is the
 * person's choice, and answering it with a red line reads as though something broke.
 */
export const PASSKEY_FAILURE_KEYS: Record<Exclude<PasskeyFailure, 'cancelled'>, string> = {
  unsupported: 'passkey.err.unsupported',
  noPrf: 'passkey.err.noPrf',
  failed: 'passkey.err.failed',
};
