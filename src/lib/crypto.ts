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
      'Web Crypto no está disponible. Usa un contexto seguro (https/localhost) o un WebView nativo.',
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
  const salt = fromBase64(box.salt);
  const iv = fromBase64(box.iv);
  const key = await deriveKey(password, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      fromBase64(box.data) as BufferSource,
    );
    return dec.decode(plain);
  } catch {
    // GCM auth tag mismatch => wrong password (or tampered data)
    throw new Error('Contraseña incorrecta.');
  }
}
