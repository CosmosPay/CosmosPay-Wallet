/**
 * Authenticated symmetric encryption helpers built on the Web Crypto API.
 *
 *   key  = PBKDF2(password, salt, 210_000 iterations, SHA-256) -> AES-256 key
 *   blob = AES-GCM(key, iv) over the UTF-8 plaintext
 *
 * AES-GCM is authenticated: decrypting with the wrong password throws,
 * which is exactly how we detect a bad unlock attempt.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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

export interface SealedBox {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext (+ GCM tag)
}

export async function seal(plaintext: string, password: string): Promise<SealedBox> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );
  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
  };
}

export async function open(box: SealedBox, password: string): Promise<string> {
  const crypto = getCrypto();
  // ALL THREE base64 fields decode OUTSIDE the try. Only the decrypt belongs inside it,
  // because only the decrypt failing means "wrong password".
  //
  // `data` used to be decoded inside, so a corrupted ciphertext threw out of `atob`, was
  // caught here, and came back as WrongPasswordError — the very confusion this class was
  // introduced to end, still live in the third field after the other two were moved out.
  // The caller then counts it as a guess: `unlock`, `revealBackup` and the dapp approval
  // window all reserve an attempt first, so a damaged vault walks the owner up the
  // backoff ladder to a five-minute lockout while the screen blames their password.
  const salt = fromBase64(box.salt);
  const iv = fromBase64(box.iv);
  const data = fromBase64(box.data);
  const key = await deriveKey(password, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data as BufferSource,
    );
    return dec.decode(plain);
  } catch {
    // GCM auth tag mismatch => wrong password (or tampered data)
    throw new WrongPasswordError();
  }
}
