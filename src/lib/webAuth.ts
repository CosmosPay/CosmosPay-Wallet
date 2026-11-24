/**
 * A SEP-10 challenge a SERVICE asks this account to sign — the manual "sign transaction"
 * screen's path for a login (an anchor's SEP-24 deposit hands one over, through Pollar's
 * ramps or anyone else's).
 *
 * The manual screen refuses every envelope sourced by another account that also names
 * ours (`foreignEnvelopeProblem`), and a challenge is exactly that shape: sourced by the
 * server, its first operation sourced by us. What makes one safe to sign is what
 * `lib/sep10.ts` already checks for recovery — sequence 0, so it can never be submitted,
 * and nothing but `manageData` — so this path reuses `assertSafeChallenge` in full.
 *
 * What recovery has and this does not is a configured server: there, the wallet knows
 * which hosts it trusts before any challenge arrives. Here the challenge names its own
 * service, so the claim is checked against that service's `stellar.toml`, the way SEP-10
 * asks a client to:
 *
 * - the TOML at `https://<home domain>/.well-known/stellar.toml` must publish a
 *   `SIGNING_KEY` — no key, no signature, because nothing would say who is asking;
 * - its `WEB_AUTH_ENDPOINT` must be on the host the challenge names as `web_auth_domain`;
 * - its `NETWORK_PASSPHRASE`, when given, must be the network the screen signs for;
 * - the challenge must be sourced by that key (`assertSafeChallenge`) AND carry a valid
 *   signature by it (`assertServerSigned`).
 *
 * The person still confirms, with the service's domain on the prompt: the checks prove
 * the login is the domain's and harmless to sign, not that the person meant to log in.
 *
 * ## Never a recovery server's
 *
 * A signed login is a credential for whoever holds it, and the screen cannot see where the
 * person pastes it next. For most services that is a phishing risk the prompt names. For a
 * SEP-30 recovery server it is an account takeover: its token changes which inbox may
 * recover the account, and then recovers it. So a challenge from a configured recovery
 * server's host (`blockedHosts`), or from any domain whose TOML lists
 * `[[RECOVERY_SERVERS]]`, is refused here outright — `lib/recovery.ts` is the only path
 * that signs those, and only for a flow the person started in the wallet itself.
 */
import { Keypair } from '@stellar/stellar-sdk';
import {
  assertSafeChallenge,
  assertServerSigned,
  challengeClaimOf,
  signChallenge,
  Sep10Error,
  webAuthDomainOf,
  type ChallengeClaim,
  type ChallengeExpectation,
} from '@/lib/sep10';
import { fetchStellarToml, type StellarToml } from '@/lib/stellarToml';
import type { NetConfig } from '@/lib/stellar';

/** Reads a host's TOML; the network fetch in the app, a table in the tests. */
export type TomlReader = (origin: string) => Promise<StellarToml | null>;

/** Reads the signers of an account; only asked when the device key is not its address. */
export type SignersReader = (cfg: NetConfig, account: string) => Promise<string[]>;

/** A challenge whose claim the service's own TOML confirmed. */
export interface VerifiedChallenge {
  claim: ChallengeClaim;
  /** What `signChallenge` checks again at the moment of signing. */
  expect: ChallengeExpectation;
}

/**
 * Check a pasted challenge against the service it names, or throw a `Sep10Error`.
 *
 * `account` is the account the login is for — the wallet's own. A challenge for any other
 * account is refused by `assertSafeChallenge` (`sep10.error.notOurs`).
 */
export async function verifyChallenge(
  cfg: NetConfig,
  xdr: string,
  account: string,
  blockedHosts: readonly string[],
  readToml: TomlReader = fetchStellarToml,
  now?: number,
): Promise<VerifiedChallenge> {
  const claim = challengeClaimOf(cfg, xdr);
  if (!claim) throw new Sep10Error('sep10.error.operations');

  // Before any fetch: a configured recovery server's challenge is never signed here.
  const blocked = new Set(blockedHosts.map((h) => h.toLowerCase()).filter(Boolean));
  if (blocked.has(claim.homeDomain.toLowerCase()) || blocked.has(claim.webAuthDomain.toLowerCase())) {
    throw new Sep10Error('sep10.error.recoveryLogin');
  }

  const toml = await readToml(`https://${claim.homeDomain}`);
  // A domain that runs SEP-30 recovery is refused whatever its host: its token can re-key accounts.
  if (toml?.recovery) throw new Sep10Error('sep10.error.recoveryLogin');
  if (!toml?.signingKey) throw new Sep10Error('sep10.error.noSigningKey');
  if (toml.networkPassphrase && toml.networkPassphrase !== cfg.passphrase) throw new Sep10Error('sep10.error.otherNetwork');
  if (!toml.webAuthEndpoint || webAuthDomainOf(toml.webAuthEndpoint) !== claim.webAuthDomain) {
    throw new Sep10Error('sep10.error.webAuthDomain');
  }

  const expect: ChallengeExpectation = {
    account,
    homeDomain: claim.homeDomain,
    webAuthDomain: claim.webAuthDomain,
    signingKey: toml.signingKey,
  };
  const tx = assertSafeChallenge(cfg, xdr, expect, now);
  assertServerSigned(tx, toml.signingKey);
  return { claim, expect };
}

/**
 * Sign a verified challenge with this device's key.
 *
 * A recovered account is signed for by a key that is not its address, so its signers are
 * read from the ledger only then — the same rule `lib/recovery.ts` follows.
 */
export async function signVerifiedChallenge(
  cfg: NetConfig,
  xdr: string,
  verified: VerifiedChallenge,
  secret: string,
  signersOf: SignersReader,
): Promise<string> {
  const key = Keypair.fromSecret(secret).publicKey();
  const signers = key === verified.expect.account ? [] : await signersOf(cfg, verified.expect.account);
  return signChallenge(cfg, xdr, verified.expect, secret, signers);
}
