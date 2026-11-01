import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  EASY_RECOVERY_CODE_LENGTH,
  EASY_RECOVERY_HKDF_INFO,
  EASY_RECOVERY_ID_LENGTH,
  EASY_RECOVERY_KEY_LENGTH,
  EASY_RECOVERY_SCHEME,
  EASY_RECOVERY_VERSION,
} from '@/constants/easyRecovery';

/**
 * Easy recovery: a wallet goes from the device that has it to one that does not, with a QR
 * and a 5-digit code, and nobody in between can read it.
 *
 *   NEW device   makes an X25519 key pair, opens a session on the community server
 *                (`easy-recovery`), and shows a QR: the session id and its PUBLIC key.
 *   OLD device   scans it, the person confirms and unlocks, and the wallet seals its secret
 *                to that public key (here: ephemeral X25519 → HKDF-SHA256 → AES-256-GCM).
 *                It sends the sealed payload with a random 5-digit code and SHOWS the code.
 *   NEW device   the person types the code; the server hands the payload over only for the
 *                right one (5 tries, then the session is burned) and the device opens it.
 *
 * Why the code goes that way round: the danger is a page that shows its OWN QR ("scan to
 * claim…"). Whoever made that QR holds its private key, so the payload is theirs to open the
 * moment they get it — and they only get it with the code on the victim's screen. The server
 * never holds a key that opens anything; its part is the attempt limit.
 *
 * Nothing here talks to the network or to the vault: the store does both.
 */

export interface EasyRecoveryLink {
  /** The server's session id. */
  id: string;
  /** The new device's X25519 public key, base64url. */
  key: string;
}

/** What travels sealed: one secret, in the form the import screen takes, and the wallet's name. */
export interface EasyRecoveryPayload {
  v: typeof EASY_RECOVERY_VERSION;
  kind: 'mnemonic' | 'secret';
  value: string;
  name?: string;
}

export class EasyRecoveryError extends Error {
  // A plain field, not a parameter property: node:test runs this file with type stripping.
  readonly reason: 'link' | 'open' | 'payload';
  constructor(reason: 'link' | 'open' | 'payload') {
    super(`easy-recovery: ${reason}`);
    this.name = 'EasyRecoveryError';
    this.reason = reason;
  }
}

/* --------------------------------- bytes --------------------------------- */

const B64URL = /^[A-Za-z0-9_-]+$/;

export function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array {
  if (!B64URL.test(text)) throw new EasyRecoveryError('link');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------------------------- link --------------------------------- */

/** A new key pair for the receiving device. The secret never leaves it, nor its memory. */
export function newReceiver(): { secret: Uint8Array; publicKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicKey: toB64url(x25519.getPublicKey(secret)) };
}

/** What the new device's QR says. No server address: each device uses its own. */
export function encodeLink(link: EasyRecoveryLink): string {
  return `${EASY_RECOVERY_SCHEME}v${EASY_RECOVERY_VERSION}?s=${link.id}&k=${link.key}`;
}

/**
 * Read a scanned or pasted QR, or null when it is not an easy-recovery QR of this version.
 * Strict on purpose: the old device is about to seal its wallet to whatever key this returns.
 */
export function parseLink(text: string): EasyRecoveryLink | null {
  const raw = text.trim();
  const prefix = `${EASY_RECOVERY_SCHEME}v${EASY_RECOVERY_VERSION}?`;
  if (!raw.startsWith(prefix)) return null;
  const params = new URLSearchParams(raw.slice(prefix.length));
  const id = params.get('s') ?? '';
  const key = params.get('k') ?? '';
  if (id.length !== EASY_RECOVERY_ID_LENGTH || key.length !== EASY_RECOVERY_KEY_LENGTH) return null;
  if (!B64URL.test(id) || !B64URL.test(key)) return null;
  try {
    if (fromB64url(key).length !== 32 || fromB64url(id).length !== 16) return null;
  } catch {
    return null;
  }
  return { id, key };
}

/* ---------------------------------- code --------------------------------- */

/**
 * A uniformly random code of `EASY_RECOVERY_CODE_LENGTH` digits. Rejection sampling: a 32-bit
 * draw taken modulo 10^5 would favour the low codes.
 */
export function newCode(
  random: (out: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = (o) => crypto.getRandomValues(o),
): string {
  const space = 10 ** EASY_RECOVERY_CODE_LENGTH;
  const limit = Math.floor(0x1_0000_0000 / space) * space;
  const buf = new Uint32Array(1);
  for (;;) {
    const n = random(buf)[0];
    if (n < limit) return String(n % space).padStart(EASY_RECOVERY_CODE_LENGTH, '0');
  }
}

/** m:ss until `at`, never negative: what both screens show of the session's five minutes. */
export function countdown(at: number, now: number): string {
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function isEasyRecoveryCode(text: string): boolean {
  return new RegExp(`^\\d{${EASY_RECOVERY_CODE_LENGTH}}$`).test(text);
}

/* --------------------------------- sealing -------------------------------- */

const enc = new TextEncoder();

/**
 * The AES key for one transfer. Both public keys and the session id go into the derivation,
 * so a payload sealed for one session or one receiver opens for no other.
 */
async function sealingKey(shared: Uint8Array, sessionId: string, sender: Uint8Array, receiver: Uint8Array): Promise<CryptoKey> {
  const info = new Uint8Array([...enc.encode(EASY_RECOVERY_HKDF_INFO), ...sender, ...receiver]);
  const raw = hkdf(sha256, shared, enc.encode(sessionId), info, 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Seal `payload` to the receiver's public key. Wire format, base64url:
 * version (1) ‖ ephemeral public key (32) ‖ IV (12) ‖ AES-GCM ciphertext and tag.
 */
export async function sealPayload(payload: EasyRecoveryPayload, link: EasyRecoveryLink): Promise<string> {
  const receiver = fromB64url(link.key);
  const eph = x25519.utils.randomSecretKey();
  const sender = x25519.getPublicKey(eph);
  const key = await sealingKey(x25519.getSharedSecret(eph, receiver), link.id, sender, receiver);
  eph.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
  return toB64url(new Uint8Array([EASY_RECOVERY_VERSION, ...sender, ...iv, ...ct]));
}

/** Open a payload sealed to this device. Throws `EasyRecoveryError` on anything else. */
export async function openPayload(
  sealed: string,
  receiverSecret: Uint8Array,
  sessionId: string,
): Promise<EasyRecoveryPayload> {
  let bytes: Uint8Array;
  try {
    bytes = fromB64url(sealed);
  } catch {
    throw new EasyRecoveryError('open');
  }
  if (bytes.length < 1 + 32 + 12 + 16 || bytes[0] !== EASY_RECOVERY_VERSION) throw new EasyRecoveryError('open');
  const sender = bytes.slice(1, 33);
  const iv = bytes.slice(33, 45);
  const receiver = x25519.getPublicKey(receiverSecret);
  let plain: ArrayBuffer;
  try {
    const key = await sealingKey(x25519.getSharedSecret(receiverSecret, sender), sessionId, sender, receiver);
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.slice(45));
  } catch {
    throw new EasyRecoveryError('open');
  }
  return readPayload(new TextDecoder().decode(plain));
}

/** The payload's shape, checked before anything acts on it. */
function readPayload(json: string): EasyRecoveryPayload {
  let p: unknown;
  try {
    p = JSON.parse(json);
  } catch {
    throw new EasyRecoveryError('payload');
  }
  const o = p as Partial<EasyRecoveryPayload>;
  if (
    !o ||
    o.v !== EASY_RECOVERY_VERSION ||
    (o.kind !== 'mnemonic' && o.kind !== 'secret') ||
    typeof o.value !== 'string' ||
    !o.value ||
    (o.name !== undefined && typeof o.name !== 'string')
  ) {
    throw new EasyRecoveryError('payload');
  }
  return { v: o.v, kind: o.kind, value: o.value, ...(o.name ? { name: o.name } : {}) };
}
