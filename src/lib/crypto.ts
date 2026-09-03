/**
 * Authenticated symmetric encryption helpers built on the Web Crypto API.
 *
 *   key  = PBKDF2(password, box.salt, box.iter, SHA-256) -> AES-256 key
 *   blob = AES-GCM(key, iv) over the UTF-8 plaintext
 *
 * AES-GCM is authenticated: decrypting with the wrong password throws,
 * which is exactly how we detect a bad unlock attempt.
 *
 * THE ITERATION COUNT TRAVELS WITH THE BOX. It used to be a module constant, which meant
 * raising it would have made every vault on every installed device undecryptable — the cost
 * was frozen by the first release that shipped it. Reading it from the box is what makes
 * `PBKDF2_ITERATIONS` a number this project can change: an old box opens at the cost it was
 * written with, and `convergeSeals` in `lib/vault.ts` re-seals it at the current one. The
 * parameters live in `constants/crypto.ts`, where they can be read as a set.
 *
 * TWO WAYS IN, AND THE SECOND ONE IS THE POINT. `seal`/`open` take a password and derive on
 * every call; `sealWithKey`/`openWithKey` take a `VaultKey` that was derived once. The
 * store holds the second kind for the length of a session and the password for none of it,
 * which is what lets `state/store.ts` open a second wallet, re-seal an API credential or
 * enrol a fingerprint without keeping the user's password in memory to do it. A `VaultKey`
 * is not a password: it is device-local, it is replaced by `changePassword`, and it is
 * worth nothing on another device.
 *
 * The box format is the SAME either way — a box carries the salt and cost it was written
 * with, whichever door produced it — so this is not a storage migration and nothing has to
 * be rewritten before it can be read.
 */
import {
  IV_BYTES,
  LEGACY_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  VAULT_KEY_BYTES,
  WRAP_KEY_BYTES,
  WRAP_KEY_ITERATIONS,
} from '@/constants/crypto';

const enc = new TextEncoder();
const dec = new TextDecoder();

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      // English, like the rest of this module: it stays dependency-free, and a missing
      // Web Crypto is an environment fault a developer reads, not a user.
      'Web Crypto is unavailable. Use a secure context (https/localhost) or a native WebView.',
    );
  }
  return c;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The GCM tag did not verify: a wrong password, or a tampered box.
 *
 * A class rather than a bare `Error`, because the failed-password ladder
 * (`lib/attempts.ts`) must count THIS and nothing else. `unlockWallet` also throws when
 * the vault blob is missing or unparseable, and callers used to treat any throw as a wrong
 * guess — so a scrambled storage entry walked the owner up to a five-minute lockout while
 * the screen said "wallet not found". Matching on the message was never an option, and
 * the message is no longer copy at all: this module stays dependency-free (it is the
 * crypto core — it should not reach for i18n, and presentation is not its job), so the
 * default below is a stable English identifier for a developer reading a stack trace.
 * Every screen that catches this renders its own translated line and branches on
 * `instanceof`, never on the text.
 */
export class WrongPasswordError extends Error {
  constructor(message = 'Wrong password.') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

/**
 * A `VaultKey` was offered a box it was not derived for.
 *
 * Distinct from `WrongPasswordError`, and the distinction is the whole reason this class
 * exists: nobody guessed anything. It means a box on this device is still sealed under
 * parameters the session's key does not cover — a `convergeSeals` pass that did not finish
 * — and the honest recovery is to unlock again with the password, not to count a failed
 * attempt against a user who never typed one.
 */
export class VaultKeyMismatchError extends Error {
  constructor() {
    super('This box was sealed under different KDF parameters.');
    this.name = 'VaultKeyMismatchError';
  }
}

export interface SealedBox {
  /**
   * 1 — no `iter` field; sealed at `LEGACY_PBKDF2_ITERATIONS`.
   * 2 — `iter` carries the cost it was sealed at.
   */
  v: 1 | 2;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext (+ GCM tag)
  /** PBKDF2 rounds. Absent on v1 boxes, and only on those. */
  iter?: number;
}

/** What a key was derived from. Public — a salt is not a secret. */
export interface KdfParams {
  salt: string; // base64
  iter: number;
}

/**
 * A derived key, and the parameters it belongs to.
 *
 * `raw` is kept ALONGSIDE the non-extractable `key`, deliberately, and it is the one
 * decision here worth arguing with. The device-unlock envelope has to seal these bytes
 * (`lib/deviceAuth.ts`) and `crypto.subtle.wrapKey` cannot export a key marked
 * non-extractable, so a session that held only the handle could not enrol a fingerprint
 * without asking for the password again — which would put the password back in memory and
 * undo the point. Marking the handle non-extractable anyway is not theatre: it is what
 * everything except enrolment uses, so a bug that leaks a key object leaks something that
 * cannot be read out.
 *
 * What this is NOT is the user's password. It is device-local, `changePassword` replaces
 * it, and it opens nothing on another device — which is why the envelope may hold it and
 * may not hold a password.
 */
export interface VaultKey {
  kdf: KdfParams;
  raw: Uint8Array;
  key: CryptoKey;
}

/**
 * The cost to open this box, refusing rather than guessing.
 *
 * A plain `Error`, never `WrongPasswordError`: a box whose parameters this build cannot use
 * is a broken box, and every caller reserves a failed-password attempt before it gets here
 * (`lib/attempts.ts`). Classifying it as a guess is how a damaged vault walks its own owner
 * up the backoff ladder while the screen blames their typing.
 *
 * The upper bound is the load-bearing half. These parameters sit OUTSIDE the AEAD — like
 * the salt and the IV they have to be read before there is a key to authenticate them with
 * — so a blob an attacker can rewrite can name its own cost. Naming a LOW one gains them
 * nothing (the derivation yields a different key and GCM refuses); naming a billion leaves
 * the unlock screen deriving until the user force-quits, which is indistinguishable from a
 * slow phone.
 */
function iterationsOf(box: SealedBox): number {
  if (box.iter === undefined) return LEGACY_PBKDF2_ITERATIONS;
  const n = box.iter;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PBKDF2_ITERATIONS) {
    throw new Error('sealed box: unusable iteration count');
  }
  return n;
}

/** The parameters a box was sealed under. Throws on a box this build cannot use. */
export function kdfOf(box: SealedBox): KdfParams {
  return { salt: box.salt, iter: iterationsOf(box) };
}

export function sameKdf(a: KdfParams, b: KdfParams): boolean {
  return a.salt === b.salt && a.iter === b.iter;
}

/** Fresh parameters at the cost this build considers current. */
export function newKdfParams(): KdfParams {
  return { salt: toBase64(getCrypto().getRandomValues(new Uint8Array(SALT_BYTES))), iter: PBKDF2_ITERATIONS };
}

/** Is this box sealed at a lower cost than the one this build writes? */
export function needsReseal(box: SealedBox): boolean {
  try {
    return iterationsOf(box) < PBKDF2_ITERATIONS;
  } catch {
    // Unreadable parameters — not "needs upgrading": nothing can open it to re-seal it.
    return false;
  }
}

/* ------------------------------- deriving ------------------------------- */

/**
 * `deriveBits`, not `deriveKey`, so the caller ends up holding the bytes as well as the
 * handle. See `VaultKey` for why both are kept.
 */
async function deriveRaw(password: string, kdf: KdfParams): Promise<Uint8Array> {
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(kdf.salt) as BufferSource, iterations: kdf.iter, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

/** Wrap raw key bytes into a usable, non-extractable AES-GCM handle. */
export async function importVaultKey(raw: Uint8Array, kdf: KdfParams): Promise<VaultKey> {
  if (raw.length !== VAULT_KEY_BYTES) throw new Error('a vault key is 32 bytes');
  const key = await getCrypto().subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { kdf, raw, key };
}

/** The expensive step, and the only one: PBKDF2 over the typed password. */
export async function deriveVaultKey(password: string, kdf: KdfParams): Promise<VaultKey> {
  return importVaultKey(await deriveRaw(password, kdf), kdf);
}

/**
 * Overwrite the derived bytes.
 *
 * Best effort and no more: it clears the one copy this module controls, so the bytes are
 * not left lying in the heap after `lock()`. The `CryptoKey` handle is not affected — it
 * lives in the browser's own key store, outside the JS heap, and becomes unreachable when
 * the session object is dropped. A JS string, which is what the password was, could not be
 * cleared at all.
 */
export function wipeVaultKey(vk: VaultKey): void {
  vk.raw.fill(0);
}

/* ------------------------------ seal / open ------------------------------ */

export async function sealWithKey(plaintext: string, vk: VaultKey): Promise<SealedBox> {
  const crypto = getCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    vk.key,
    enc.encode(plaintext),
  );
  return {
    v: 2,
    salt: vk.kdf.salt,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
    iter: vk.kdf.iter,
  };
}

/**
 * Open a box with a key that was already derived.
 *
 * The parameter check comes FIRST and throws its own error. A key derived for other
 * parameters would otherwise fail at the GCM tag and be reported as a wrong password —
 * about a user who typed nothing, on a path (`switchWallet`, an API credential read) where
 * nobody is guessing. The two failures need different answers: one is "try again", the
 * other is "this box was never covered by this key".
 */
export async function openWithKey(box: SealedBox, vk: VaultKey): Promise<string> {
  if (!sameKdf(kdfOf(box), vk.kdf)) throw new VaultKeyMismatchError();
  const crypto = getCrypto();
  const iv = fromBase64(box.iv);
  const data = fromBase64(box.data);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      vk.key,
      data as BufferSource,
    );
    return dec.decode(plain);
  } catch {
    // GCM auth tag mismatch => wrong password (or tampered data)
    throw new WrongPasswordError();
  }
}

/** Seal under a human password, at the cost and with a salt this build considers current. */
export async function seal(plaintext: string, password: string): Promise<SealedBox> {
  return sealWithKey(plaintext, await deriveVaultKey(password, newKdfParams()));
}

/**
 * Open a box with a password, deriving at whatever cost the box names.
 *
 * The base64 fields and the iteration count are read BEFORE any decrypt, and only the
 * decrypt can produce a `WrongPasswordError`. `data` used to be decoded inside the try, so
 * a corrupted ciphertext threw out of `atob`, was caught, and came back as a wrong
 * password — and every caller reserves an attempt first, so a damaged vault walked the
 * owner up the backoff ladder to a five-minute lockout while the screen blamed their
 * password.
 */
export async function open(box: SealedBox, password: string): Promise<string> {
  const kdf = kdfOf(box);
  // Decoded here as well as in `openWithKey`, so a damaged box fails in microseconds
  // instead of after a full derivation. The answer is the same either way; the wait is not.
  fromBase64(box.iv);
  fromBase64(box.data);
  return openWithKey(box, await deriveVaultKey(password, kdf));
}

/* --------------------------- sealing under a random key --------------------------- */

/**
 * Refuse anything that is not a 32-byte CSPRNG key in base64.
 *
 * This check is the whole reason the two functions below are their own pair rather than an
 * `iterations` argument on `seal`. An optional cost parameter is only as careful as its
 * laziest caller — the argument `GuardOptions` in `lib/txGuard.ts` is built on — and the
 * laziest caller here would be one passing a human password with the wrapping-key cost,
 * silently sealing a vault behind a single PBKDF2 round. A password does not decode to
 * exactly 32 bytes of base64, so that mistake cannot get past this.
 */
function assertWrapKey(wrapKey: string): string {
  let bytes: Uint8Array | null;
  try {
    bytes = fromBase64(wrapKey);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length !== WRAP_KEY_BYTES) {
    throw new Error('wrap key must be 32 base64-encoded bytes');
  }
  return wrapKey;
}

/**
 * Seal under a full-entropy wrapping key rather than a password — see `WRAP_KEY_ITERATIONS`
 * for why there is no stretching here, and `lib/deviceAuth.ts` for what holds the key.
 */
export async function sealUnderWrapKey(plaintext: string, wrapKey: string): Promise<SealedBox> {
  const kdf: KdfParams = { ...newKdfParams(), iter: WRAP_KEY_ITERATIONS };
  return sealWithKey(plaintext, await deriveVaultKey(assertWrapKey(wrapKey), kdf));
}

/**
 * Open a box sealed under a wrapping key.
 *
 * Needs no version branch: envelopes written before `sealUnderWrapKey` existed are v1 boxes
 * with no `iter`, and `open` derives those at the legacy cost. An enrolment made by an older
 * build keeps working — one whole PBKDF2 derivation slower than it needs to be — until it
 * is next written, which is the next time the user enrols or changes their password.
 */
export async function openUnderWrapKey(box: SealedBox, wrapKey: string): Promise<string> {
  return open(box, assertWrapKey(wrapKey));
}

/**
 * Are these the parameters this build writes with?
 *
 * Exported so `lib/vault.ts` can decide whether a session's key is worth converging onto
 * without importing the cost constant itself — the number belongs to one module, and a
 * second reader is a second place to forget when it moves.
 */
export function kdfIsCurrent(kdf: KdfParams): boolean {
  return kdf.iter >= PBKDF2_ITERATIONS;
}
