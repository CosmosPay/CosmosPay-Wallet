/**
 * A sealed box in the shape the first releases wrote: `v: 1`, no `iter`, 210,000 PBKDF2
 * rounds over SHA-256.
 *
 * ONE definition, imported by every test that needs one, and the literal below must NOT be
 * replaced by `LEGACY_PBKDF2_ITERATIONS`. It is not a setting — it is a fact about every
 * wallet already installed on a phone. A fixture that read the number from the same place
 * the code reads it would keep passing while those wallets stopped opening, which is the
 * one failure these tests exist to catch.
 *
 * Built with raw Web Crypto rather than `lib/crypto`, for the same reason: the module under
 * test cannot be the thing that defines what "old" looked like.
 */
import { toBase64, type SealedBox } from '@/lib/crypto';

export const SHIPPED_ITERATIONS = 210_000;

export async function legacyBox(plaintext: string, password: string): Promise<SealedBox> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: SHIPPED_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}
