/**
 * Domain-separated message signing.
 *
 * A Stellar transaction signature is ed25519 over the 32-byte transaction hash.
 * If `signMessage` signed the caller's bytes directly, a dapp could hand over 32
 * bytes that happen to BE a transaction hash and receive a signature that is
 * valid as a transaction signature — the UI would show it as an unreadable
 * "message". Same key, two protocols, no separation.
 *
 * So we never sign caller bytes. We sign SHA-256 over a fixed domain prefix, a
 * length, and the message. The digest is therefore constrained by the prefix:
 * producing one that equals a chosen transaction hash needs a preimage attack.
 *
 * Verifiers must recompute the same payload — the prefix is part of the contract.
 */

/** Domain tag. Changing it invalidates every previously issued signature. */
export const SIGN_MESSAGE_DOMAIN = 'Cosmos Wallet signed message v1';

/**
 * Build the 32-byte digest to sign for `message`.
 * Payload = domain || 0x00 || uint32be(byteLength) || message
 */
export async function signMessagePayload(message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const domain = enc.encode(SIGN_MESSAGE_DOMAIN);
  const body = enc.encode(message);

  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, body.length, false);

  const payload = new Uint8Array(domain.length + 1 + len.length + body.length);
  payload.set(domain, 0);
  payload[domain.length] = 0x00; // separator — keeps domain and length unambiguous
  payload.set(len, domain.length + 1);
  payload.set(body, domain.length + 1 + len.length);

  const digest = await crypto.subtle.digest('SHA-256', payload as BufferSource);
  return new Uint8Array(digest);
}
