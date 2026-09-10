/**
 * Proof that the wallet reporting a crash is the wallet it claims to be.
 *
 * A diagnostics feed is unauthenticated in the only sense that matters: the events are
 * whatever the client says they are. Anyone who learns an install id can post events
 * wearing it, and an error report is exactly the thing worth forging — it is how you get
 * a support team to act on an account that is not yours. So a report carries a signature
 * from the key that owns the account it is about.
 *
 * ## It is a DIGEST, not a transaction
 *
 * The obvious build is a Stellar transaction signed in the background, and it is the
 * wrong one. A signed envelope is a submittable envelope unless something guarantees
 * otherwise, and the thing that guarantees it here would be a sequence number nobody
 * re-checks after the next refactor. This wallet already owns the safe primitive and
 * already wrote down why (`lib/signMessage.ts`): sign SHA-256 over a domain prefix, a
 * length and a body, so producing a digest that equals a chosen transaction hash needs a
 * preimage attack. Nothing this module signs can ever be a transaction signature,
 * whatever it is handed.
 *
 * The domain is its OWN — {@link ATTESTATION_DOMAIN}, never `SIGN_MESSAGE_DOMAIN`. A dapp
 * can ask a user to sign any string it likes through the approval window; if the two
 * protocols shared a tag it would ask for a well-formed attestation and get one.
 *
 * ## What it binds, and why each part
 *
 * - **address** — the account being vouched for. The claim is about this and nothing else.
 * - **installId** — the reporter's anonymous install id. Without it the signature proves
 *   ownership of an account but says nothing about WHICH event stream is that account's,
 *   which is the actual question.
 * - **network passphrase** — so an attestation made on testnet is not evidence about the
 *   mainnet account with the same key. The passphrase, not the network's display name: a
 *   custom network can call itself anything.
 * - **issuedAt** — with {@link ATTESTATION_MAX_AGE_MS}, what stops it being a standing
 *   credential. It is minted with no prompt, so it must expire on its own.
 *
 * ## What it is not
 *
 * It is not authentication for the API — the key in the `Authorization` header is that.
 * It is not an identity for an anonymous wallet either: it NAMES an account, so on the
 * shared/public-key route it is stripped exactly as an address is (see `ACCOUNT_PROPS` in
 * `lib/telemetry.ts`). Proving ownership there would mean publishing the address to a
 * consumer that is every anonymous wallet at once, which is the one thing that route
 * exists to prevent.
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  ATTESTATION_DOMAIN,
  ATTESTATION_MAX_AGE_MS,
  ATTESTATION_VERSION,
} from '@/constants/telemetry';
import { signMessagePayload } from '@/lib/signMessage';

/** What travels on the event. `v` lets a verifier refuse a shape it does not know. */
export interface OwnershipAttestation {
  v: number;
  address: string;
  installId: string;
  /** The network's passphrase, not its display name — see the header. */
  network: string;
  /** Epoch milliseconds. */
  issuedAt: number;
  /** base64 ed25519 over the digest of {@link attestationMessage}. */
  sig: string;
}

/**
 * The exact string that gets digested. A verifier MUST rebuild it byte for byte.
 *
 * Newline-separated `key: value`, with the version first, because a verifier reading a
 * shape it does not know has to be able to say so before it interprets anything else.
 * The fields are fixed-order and none is optional: a builder that omitted one would
 * produce a shorter string that still parses, and two different claims must never digest
 * the same.
 */
export function attestationMessage(a: Omit<OwnershipAttestation, 'sig'>): string {
  return [
    `version: ${a.v}`,
    `address: ${a.address}`,
    `install: ${a.installId}`,
    `network: ${a.network}`,
    `issuedAt: ${a.issuedAt}`,
  ].join('\n');
}

/**
 * Sign an attestation for `address` with `secret`.
 *
 * The secret is a parameter and is never held here: the caller fetches it per use from
 * the vault (`secretOf`) and lets it fall out of scope, which is the rule the whole
 * session redesign turns on. This module keeps nothing.
 */
export async function signOwnership(input: {
  secret: string;
  address: string;
  installId: string;
  networkPassphrase: string;
  now?: number;
}): Promise<OwnershipAttestation> {
  const body: Omit<OwnershipAttestation, 'sig'> = {
    v: ATTESTATION_VERSION,
    address: input.address,
    installId: input.installId,
    network: input.networkPassphrase,
    issuedAt: input.now ?? Date.now(),
  };
  const digest = await signMessagePayload(attestationMessage(body), ATTESTATION_DOMAIN);
  const sig = Keypair.fromSecret(input.secret).sign(Buffer.from(digest)).toString('base64');
  return { ...body, sig };
}

/**
 * Is `a` still attachable?
 *
 * Both ends are checked, and the future end is not paranoia: a device whose clock is
 * ahead mints attestations stamped in the future, and treating those as valid forever is
 * how the expiry stops meaning anything. An attestation from ahead of now is not
 * trusted here — it is simply rebuilt, which costs one vault read.
 */
export function attestationFresh(a: OwnershipAttestation | null, now: number = Date.now()): boolean {
  if (!a) return false;
  const age = now - a.issuedAt;
  return age >= 0 && age < ATTESTATION_MAX_AGE_MS;
}

/**
 * Verify one, for a reader that has the address the claim is about.
 *
 * Exported because the wallet is the only place that knows how the payload is built, and
 * a verifier written from a description rather than from this function is a verifier that
 * will disagree with it eventually. `tests/unit/attestation.test.ts` uses it as the
 * executable half of the contract.
 */
export async function verifyOwnership(a: OwnershipAttestation, now: number = Date.now()): Promise<boolean> {
  if (!attestationFresh(a, now)) return false;
  if (a.v !== ATTESTATION_VERSION) return false;
  try {
    const digest = await signMessagePayload(attestationMessage(a), ATTESTATION_DOMAIN);
    return Keypair.fromPublicKey(a.address).verify(Buffer.from(digest), Buffer.from(a.sig, 'base64'));
  } catch {
    // A malformed address or a base64 that is not a signature: not a crash, just false.
    return false;
  }
}
