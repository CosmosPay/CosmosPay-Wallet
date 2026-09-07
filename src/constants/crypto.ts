/**
 * Vault crypto parameters. Data only — `src/lib/crypto.ts` is what uses them.
 *
 * Collected here rather than left at the top of the module that reads them, for the reason
 * CLAUDE.md gives for `constants/`: a cost parameter buried in an implementation file is a
 * cost parameter nobody audits. These are the first numbers an auditor asks for, and they
 * should be readable as a set.
 */

/**
 * PBKDF2 rounds for anything sealed under a HUMAN password: the wallet secret and the
 * CosmosPay credential.
 *
 * 600,000 is OWASP's figure for PBKDF2-HMAC-SHA256. The wallet shipped 210,000 for its
 * first releases, which is the figure from the SHA-512 row of the same table — a mismatch
 * rather than a considered discount, and roughly a 3x cut in the cost of grinding a stolen
 * vault file offline. For scale, the wallets this one is measured against: MetaMask derives
 * at 900,000 PBKDF2-SHA256 rounds, and Freighter uses scrypt (N=32768, r=8), which is
 * memory-hard and so harder again to accelerate on a GPU.
 *
 * The cost is paid on unlock, on the signing gate's password check and on `revealBackup` —
 * roughly 0.6-1.2s on a phone. That is about the ceiling a user tolerates on an unlock
 * screen, so the next real gain is a memory-hard KDF, not a bigger number here.
 */
export const PBKDF2_ITERATIONS = 600_000;

/**
 * What a box carrying no `iter` field was sealed at.
 *
 * Not a floor and not a guess: every box written before the field existed used exactly
 * this. `convergeSeals` in `src/lib/vault.ts` re-seals them at the current cost after the
 * first successful unlock, but until that has run they still have to open.
 */
export const LEGACY_PBKDF2_ITERATIONS = 210_000;

/**
 * The most rounds this build will attempt on behalf of a stored box.
 *
 * KDF parameters sit OUTSIDE the AEAD — like the salt and the IV they must be read before
 * there is a key to authenticate them with. Lowering `iter` on a stored box gains an
 * attacker nothing (the derivation yields a different key and GCM refuses), but raising it
 * to a billion is a denial of service on the unlock screen: the app would sit deriving
 * until the user force-quits, with no way to tell that from a slow phone. A ceiling is the
 * whole defence and it costs one comparison.
 */
export const MAX_PBKDF2_ITERATIONS = 4_000_000;

/**
 * Rounds used when the "password" is itself a full-entropy key — the device-unlock wrapping
 * key in `src/lib/deviceAuth.ts`, 32 bytes straight out of `getRandomValues`.
 *
 * One. PBKDF2 exists to make a LOW-entropy secret expensive to guess, and there is nothing
 * to stretch in 256 bits of CSPRNG output; an attacker holding that key is not guessing at
 * all. Iterating would only add latency to the biometric unlock, which already pays a full
 * derivation for the vault behind it — and a convenience feature that feels slow is one the
 * user turns off, which is how a hardware-bound key loses to a typed password.
 */
export const WRAP_KEY_ITERATIONS = 1;

/** Bytes of CSPRNG output in a device-unlock wrapping key. */
export const WRAP_KEY_BYTES = 32;

/** Per-box PBKDF2 salt. 128 bits of uniqueness is what a salt is for. */
export const SALT_BYTES = 16;

/** AES-GCM IV. Twelve bytes is the size GCM is defined over; any other length is hashed first. */
export const IV_BYTES = 12;

/** Bytes in a derived vault key. AES-256, so 32 — the same size as the wrapping key. */
export const VAULT_KEY_BYTES = 32;
