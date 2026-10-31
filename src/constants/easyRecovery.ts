/**
 * Easy recovery: moving a wallet from a device that has it to one that does not, with a QR
 * and a 5-digit code (src/lib/easyRecovery.ts). Data only.
 */

/** What the new device's QR starts with. A scanner that reads anything else is not looking at one. */
export const EASY_RECOVERY_SCHEME = 'cosmos-easy-recovery:';

/** The protocol version the QR and the sealed payload carry. A different one is refused, not guessed. */
export const EASY_RECOVERY_VERSION = 1;

/** Digits in the code the old device shows and the new one types. */
export const EASY_RECOVERY_CODE_LENGTH = 5;

/** Wrong codes the server takes before it burns the session (the community server's own limit too). */
export const EASY_RECOVERY_MAX_ATTEMPTS = 5;

/** How often both screens ask the server where the session is. */
export const EASY_RECOVERY_POLL_MS = 2000;

/**
 * The HKDF `info` the sealing key is derived under. Never change it: a payload sealed under
 * one label opens under no other, and both devices may run different releases.
 */
export const EASY_RECOVERY_HKDF_INFO = 'cosmos-easy-recovery/v1';

/** A session id: 16 random bytes, base64url without padding. */
export const EASY_RECOVERY_ID_LENGTH = 22;

/** An X25519 public key: 32 bytes, base64url without padding. */
export const EASY_RECOVERY_KEY_LENGTH = 43;
