/**
 * SEP-30 account recovery — the wallet's half.
 *
 * ## What it is
 *
 * Two servers each hold one signer on the account, at half its threshold. The device key
 * keeps enough weight to sign alone, so nothing about ordinary use changes; if the device
 * is lost, the two servers together — and only together — co-sign a new key onto the
 * account. The arithmetic and the reason for each number are in `constants/recovery.ts`.
 *
 * ## What it is not
 *
 * It replaces nothing. A local wallet whose seed only ever existed on one device stays
 * exactly that until someone turns this on, and turning it off is theirs to do too. It is
 * also not the encrypted cloud backup (`lib/cloudBackup.ts`): that answers "I have my
 * password and a new phone", this answers "I have neither". They coexist on purpose —
 * each fails where the other works.
 *
 * ## Three things that are deliberately not done here
 *
 * - **Nothing trusts a server about the shape of the account.** The weights come from the
 *   wallet's own constants, the network from the wallet's own `NetConfig`, and the setup
 *   transaction goes through `assertSafeToSign`'s `recovery` template before it is signed —
 *   including the variant a server built. A server that could describe its own weight could
 *   describe one that makes it sufficient alone.
 * - **A challenge is never signed unread.** `lib/sep10.ts` decodes it first; the property
 *   that makes it safe is its sequence number of 0, which the wallet checks for itself.
 * - **The two servers are never asked to agree.** Each is registered separately, each mints
 *   its own tokens, and a token from one is refused by the other. The whole point is that
 *   they are two.
 */
import { Account, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  recoveryAccount,
  recoveryAccounts,
  recoveryEmailStart,
  recoveryEmailVerify,
  recoveryForget,
  recoveryIdentityFromIdToken,
  recoveryRegister,
  recoverySign,
  recoveryUpdateIdentities,
  sep10Challenge,
  sep10Token,
  type RecoveryAccount,
  type RecoveryEmailResult,
} from '@/lib/cosmospay';
import { recoveryServers as configuredServers } from '@/lib/endpoints';
import { fetchStellarToml } from '@/lib/stellarToml';
import { ApiRequestError } from '@/lib/apiError';
import { tNow } from '@/lib/i18n';
import { signChallenge, webAuthDomainOf } from '@/lib/sep10';
import { getServer, type NetConfig } from '@/lib/stellar';
import {
  DEVICE_WEIGHT,
  IDENTITY_ROLE_OWNER,
  RECOVERY_LIST_MAX_PAGES,
  RECOVERY_SERVER_COUNT,
  RECOVERY_TIMEOUT_S,
  SERVER_WEIGHT,
  type RecoveryRole,
} from '@/constants/recovery';

/** Why recovery stopped. `key` is an i18n key; nothing ever branches on the message. */
export class RecoveryError extends Error {
  readonly key: string;
  readonly params: Record<string, string | number> | undefined;
  constructor(key: string, params?: Record<string, string | number>) {
    super(tNow(key, params));
    this.name = 'RecoveryError';
    this.key = key;
    this.params = params;
  }
}

/** One recovery server, once it has said what it is. */
export interface RecoveryServer {
  role: RecoveryRole;
  /** The host as configured. Only this wallet's own extensions hang off it. */
  url: string;
  /**
   * The SEP-30 BASE: what the spec's paths are relative to, so `${sep30Base}/accounts`.
   *
   * Separate from `url` because they are only the same thing on a server that is nothing
   * but a recovery server. Ours is one module of the community server and lives under
   * `/v1/sep30` behind the gateway entry; a standalone SEP-30 deployment is usually the
   * bare host. It is always what the server's TOML publishes: the wallet used to build a
   * prefix itself, which is precisely what made it unable to talk to anybody else's
   * server — the bodies were already the standard's.
   */
  sep30Base: string;
  /** The server's published `WEB_AUTH_ENDPOINT`, whole — a URL, never a path to assemble. */
  webAuthEndpoint: string;
  /** The host its challenges must name — checked, not assumed. */
  webAuthDomain: string;
  homeDomain: string;
  /** Its published `SIGNING_KEY` — what proves who minted a challenge. Always present. */
  signingKey: string;
  /** The OIDC issuer whose ID tokens it exchanges for an identity, when it takes any. */
  oidcIssuer?: string;
  /** Whether it can prove an inbox with its own emailed code. */
  emailCodes: boolean;
}

/** Is this build configured for recovery at all? */
export function recoveryConfigured(): boolean {
  return configuredServers().length === RECOVERY_SERVER_COUNT;
}

/**
 * Ask both servers what they are, and refuse a pair that could not protect anything.
 *
 * The checks here are what a wallet can know before it commits: that both answered, that
 * they are DIFFERENT hosts, that they are on the network this wallet is on, that each one's
 * challenges will name its own host, and that the two AGREE on the wallet's home domain. A signer is an entry on one ledger — two servers
 * pointed at different networks register an account happily and can never recover it, and
 * that is a failure the user would meet years later with nothing to do about it.
 */
export async function loadRecoveryServers(cfg: NetConfig): Promise<RecoveryServer[]> {
  const configured = configuredServers();
  if (configured.length !== RECOVERY_SERVER_COUNT) throw new RecoveryError('recovery.error.notConfigured');

  const servers = await Promise.all(configured.map(({ role, url }) => describeServer(cfg, role, url)));

  if (servers[0].webAuthDomain === servers[1].webAuthDomain) throw new RecoveryError('recovery.error.sameServer');
  // The home domain is the one expectation a server supplies about itself, and
  // `assertSafeChallenge` then checks the challenge against it — so on its own it catches
  // only a server contradicting itself. Requiring the two to AGREE is what makes it a
  // check: the servers are independent deployments, and whoever controls one cannot
  // change what the other says.
  if (servers[0].homeDomain !== servers[1].homeDomain) throw new RecoveryError('recovery.error.homeDomain');
  return servers;
}

/**
 * Ask one server what it is — from its `/.well-known/stellar.toml`, and only from there.
 *
 * Every field the wallet acts on comes out of that file and is checked against what the
 * wallet already knows, and anything missing is a refusal rather than a default:
 *
 *  - `SIGNING_KEY` is REQUIRED. It is what makes SEP-10 a proof of who minted a challenge;
 *    a server discovered without it is one whose challenges the wallet could only check the
 *    shape of. The old fallback (`/api/recovery/info` on the developer platform) could not
 *    supply one, and it is gone with the platform's recovery module.
 *  - `NETWORK_PASSPHRASE` is REQUIRED and must be the wallet's own: a signer is an entry on
 *    ONE ledger, and a mismatch found at recovery time is a failure with nothing left to do.
 *  - `WEB_AUTH_ENDPOINT` and the `[[RECOVERY_SERVERS]]` `ENDPOINT` must both be on the host
 *    the wallet was configured with. A TOML that points either somewhere else is handing the
 *    wallet to a party the user never chose.
 *  - The home domain is the server's claim about the WALLET, not its own host — see
 *    `loadRecoveryServers`, which is what turns it into a check.
 */
export async function describeServer(cfg: NetConfig, role: RecoveryRole, url: string): Promise<RecoveryServer> {
  const host = webAuthDomainOf(url);
  const toml = await fetchStellarToml(url);
  const endpoint = toml?.recovery?.endpoint;

  if (!toml?.webAuthEndpoint || !toml.signingKey || !endpoint) {
    throw new RecoveryError('recovery.error.discovery', { server: host });
  }
  if (toml.networkPassphrase !== cfg.passphrase) {
    throw new RecoveryError('recovery.error.network', { server: host });
  }
  const webAuthDomain = webAuthDomainOf(toml.webAuthEndpoint);
  if (webAuthDomain !== host || webAuthDomainOf(endpoint) !== host) {
    throw new RecoveryError('recovery.error.domain', { server: host });
  }
  if (!toml.homeDomain) throw new RecoveryError('recovery.error.homeDomain');

  return {
    role,
    url,
    sep30Base: endpoint.replace(/\/+$/, ''),
    webAuthEndpoint: toml.webAuthEndpoint,
    webAuthDomain,
    homeDomain: toml.homeDomain,
    signingKey: toml.signingKey,
    oidcIssuer: toml.recovery?.oidcIssuer,
    emailCodes: toml.recovery?.emailCodes === true,
  };
}

/* ------------------------------- proving the key ------------------------------- */

/**
 * A SEP-10 token from one server, proving this device holds the account's key.
 *
 * The challenge is checked before it is signed — see `lib/sep10.ts`, and note that what
 * is passed as the expected web-auth domain is derived from the URL the wallet called, not
 * from anything the server said about itself.
 */
export async function authenticate(cfg: NetConfig, server: RecoveryServer, address: string, secret: string): Promise<string> {
  const challenge = await sep10Challenge(server.webAuthEndpoint, address);
  const signed = signChallenge(cfg, challenge.transaction, {
    account: address,
    homeDomain: server.homeDomain,
    webAuthDomain: server.webAuthDomain,
    signingKey: server.signingKey,
  }, secret);
  const { token } = await sep10Token(server.webAuthEndpoint, signed);
  return token;
}

/* --------------------------------- enabling ---------------------------------- */

/**
 * Who may recover, in SEP-30's shape.
 *
 * One identity, in the `owner` role, reachable at one email. The spec also allows
 * `stellar_address` and `phone_number` auth methods; this wallet registers neither, and
 * that is a deliberate ceiling rather than an omission — every additional method is
 * another way to reach the same account, and the list is what an attacker needs only one
 * of. Adding one is adding a door, and belongs behind the same explicit confirmation
 * turning recovery on already has.
 *
 * Shared by registration and update precisely so the two cannot describe the identity
 * differently: an update that normalised the address differently from the registration
 * would silently point the account at a second inbox.
 */
export function identitiesFor(email: string): { role: string; auth_methods: { type: string; value: string }[] }[] {
  return [{ role: IDENTITY_ROLE_OWNER, auth_methods: [{ type: 'email', value: email.trim().toLowerCase() }] }];
}

/**
 * Point an already-registered account at a different email, on BOTH servers.
 *
 * This is the one thing a wallet cannot do by reading: an identity is write-only from
 * outside, so a wallet whose email has changed since enrolment cannot tell whether the
 * servers agree with it, only assert what they should hold. Which is why the caller
 * records what it sent — see `WalletEntry.recoveryEmail`.
 *
 * Sequential and both-or-nothing-said, for the reason registration is: a first server
 * updated and a second one failing leaves the account recoverable from EITHER inbox, and
 * the old one is precisely the one whose owner may no longer be the user. The failure
 * names the server, and the caller keeps the old address on record — claiming the new one
 * when only one server took it would be the more dangerous lie.
 */
export async function updateRecoveryIdentities(
  cfg: NetConfig,
  servers: readonly RecoveryServer[],
  address: string,
  secret: string,
  email: string,
): Promise<void> {
  const identities = identitiesFor(email);
  for (const server of servers) {
    const token = await authenticate(cfg, server, address, secret);
    await recoveryUpdateIdentities(server.sep30Base, token, address, identities);
  }
}

/**
 * Register the account with both servers and collect the signer each one holds for it.
 *
 * Returns them in role order, which is the order the setup transaction adds them in and
 * the order the screen showed. `email` is the identity that will be allowed to recover:
 * whoever can prove that inbox to both servers can, with both of them, put a new key on
 * this account — which is the whole bargain, and the screen says so before this runs.
 */
export async function registerForRecovery(
  cfg: NetConfig,
  servers: readonly RecoveryServer[],
  address: string,
  secret: string,
  email: string,
): Promise<[string, string]> {
  const identities = identitiesFor(email);
  const signers: string[] = [];

  // Sequential, not parallel: registering is a write, and a second server registered while
  // the first is failing leaves an account half-protected with nothing telling the user
  // which half. The first failure stops the flow with the server named.
  for (const server of servers) {
    const token = await authenticate(cfg, server, address, secret);
    // 409 means this server already holds the account — from an enrolment that registered
    // here and then failed before the transaction reached the ledger, which is exactly the
    // state someone retries from. SEP-30 answers that with PUT: the identities are stated
    // again, and the server returns the signer it has always held for this account, which
    // is the value this loop is actually here to collect. Registering twice is the one
    // thing the spec asks a server to refuse, so this is the sanctioned way through.
    const account = await recoveryRegister(server.sep30Base, token, address, identities).catch((e) => {
      if (e instanceof ApiRequestError && e.status === 409) {
        return recoveryUpdateIdentities(server.sep30Base, token, address, identities);
      }
      throw e;
    });
    const key = account.signers[0]?.key;
    if (!key) throw new RecoveryError('recovery.error.noSigner', { server: server.webAuthDomain });
    signers.push(key);
  }

  if (signers[0] === signers[1]) throw new RecoveryError('recovery.error.sameSigner');
  if (signers.includes(address)) throw new RecoveryError('recovery.error.signerIsAccount');
  return [signers[0], signers[1]];
}

export interface SetupInput {
  account: string;
  signers: readonly [string, string];
  /** The account's CURRENT sequence, from Horizon. The builder increments it. */
  sequence: string;
  networkPassphrase: string;
}

/**
 * The setup transaction, in the variant the account pays for itself.
 *
 * Byte-for-byte the same shape the operator's sponsored builder produces minus the
 * sponsorship pair — deliberately, so one template in the guard covers both and neither
 * builder is the one that defines what is acceptable.
 *
 * `Memo.none()` and not `buildMemo`: the wallet's default memo names the client on every
 * transaction it builds, and there is nothing to name here. The sponsored variant carries
 * none either, and a template that matched two different memos would be describing two
 * transactions.
 */
export function buildRecoverySetup(input: SetupInput): string {
  const source = new Account(input.account, input.sequence);
  const builder = new TransactionBuilder(source, {
    fee: String(Number(BASE_FEE) * 3),
    networkPassphrase: input.networkPassphrase,
    memo: Memo.none(),
  });
  for (const key of input.signers) {
    builder.addOperation(Operation.setOptions({ source: input.account, signer: { ed25519PublicKey: key, weight: SERVER_WEIGHT } }));
  }
  // Last: with the signers in place, "enough signatures" can be raised to a number the two
  // servers together reach and neither reaches alone.
  builder.addOperation(
    Operation.setOptions({
      source: input.account,
      masterWeight: DEVICE_WEIGHT,
      lowThreshold: DEVICE_WEIGHT,
      medThreshold: DEVICE_WEIGHT,
      highThreshold: DEVICE_WEIGHT,
    }),
  );
  return builder.setTimeout(RECOVERY_TIMEOUT_S).build().toXDR();
}

/**
 * The challenge the operator's sponsored builder asks for. Must match the community server
 * byte for byte (`recoverySetupMessage` in its wallet-auth-core module); both sides pin the
 * same literal in their tests.
 *
 * It covers the two signers as well as the account, so one signature authorises one
 * arrangement: a sponsorship built for a different pair of servers is a different message.
 */
export function recoverySetupMessage(address: string, signers: readonly string[], signedAt: string): string {
  return `Cosmos Pay Wallet recovery setup\naccount: ${address}\nsigners: ${[...signers].join(',')}\nat: ${signedAt}`;
}

/**
 * Sign that challenge. Only ever this fixed format, which begins with a line no
 * transaction can — never bytes a caller supplies.
 */
export function signedRecoverySetup(secret: string, address: string, signers: readonly string[]): { signedAt: string; signature: string } {
  const signedAt = new Date().toISOString();
  const signature = Buffer.from(
    Keypair.fromSecret(secret).sign(Buffer.from(recoverySetupMessage(address, signers, signedAt), 'utf8')),
  ).toString('base64');
  return { signedAt, signature };
}

export interface RemovalInput {
  account: string;
  /** The recovery signers currently on the account, as the LEDGER reports them. */
  signers: readonly string[];
  sequence: string;
  networkPassphrase: string;
}

/**
 * Turn recovery off: every recovery signer back to weight 0, and the thresholds back to
 * one signature.
 *
 * The thresholds go LAST, as they went on: lowering them first would leave a moment — one
 * operation wide, inside one transaction — where two servers that are still signers meet a
 * threshold of 1. It never reaches the ledger in between, but building it the other way
 * round is the kind of ordering that survives into somewhere it does matter.
 */
export function buildRecoveryRemoval(input: RemovalInput): string {
  const source = new Account(input.account, input.sequence);
  const builder = new TransactionBuilder(source, {
    fee: String(Number(BASE_FEE) * (input.signers.length + 1)),
    networkPassphrase: input.networkPassphrase,
    memo: Memo.none(),
  });
  for (const key of input.signers) {
    builder.addOperation(Operation.setOptions({ source: input.account, signer: { ed25519PublicKey: key, weight: 0 } }));
  }
  // The thresholds stay at the device's weight rather than dropping back to 1. "Recovery
  // off" means only this device signs, and 1 would be weaker than that: any other signer
  // the account carries — a co-signer, a service — would become sufficient alone the moment
  // recovery was turned off, which is not what the person asked for and not a state they
  // would be told about.
  builder.addOperation(
    Operation.setOptions({
      source: input.account,
      masterWeight: DEVICE_WEIGHT,
      lowThreshold: DEVICE_WEIGHT,
      medThreshold: DEVICE_WEIGHT,
      highThreshold: DEVICE_WEIGHT,
    }),
  );
  return builder.setTimeout(RECOVERY_TIMEOUT_S).build().toXDR();
}

/** The account's current sequence, which both setup variants are built on. */
export async function sequenceOf(cfg: NetConfig, address: string): Promise<string> {
  const account = await getServer(cfg).loadAccount(address);
  return account.sequenceNumber();
}

/** Whether recovery is actually on for an account, read from the ledger. */
export interface RecoveryState {
  exists: boolean;
  /** Two signers at the servers' weight, and thresholds that need both of them. */
  enabled: boolean;
  /** The recovery signers found on chain — for display, and to remove them again. */
  signers: string[];
}

const NOT_FUNDED: RecoveryState = { exists: false, enabled: false, signers: [] };

/**
 * Is recovery on for this account?
 *
 * Read from HORIZON, never from the servers' own listing. A server that knows about an
 * account has not necessarily been put on it — registering and signing the setup
 * transaction are two steps and the second one can fail — so asking the server would
 * report protection the ledger does not provide. The ledger is the only place the answer
 * actually lives, and it needs no authentication to read.
 *
 * **All THREE thresholds, and the master weight.** Checking only `med_threshold` was
 * checking the wrong number: adding a signer and changing thresholds are HIGH-threshold
 * operations on Stellar, so `high_threshold` is precisely the one that decides whether one
 * recovery server can re-key the account on its own. An account left at `high: 5` — which
 * a dapp can ask for, since the dapp path renders `setOptions` rather than refusing it —
 * was one server away from a takeover while this function reported it healthy. The master
 * weight is here for the mirror case: at 0 the device cannot sign at all and the two
 * servers own the account outright.
 *
 * `signers` is a HEURISTIC and is used for display only: any signer at the servers'
 * weight looks like one of them from here. Nothing destructive is driven from it — see
 * `signersToRemove`, which asks the servers themselves.
 */
export async function recoveryStateOf(cfg: NetConfig, address: string): Promise<RecoveryState> {
  let account: { signers: { key: string; weight: number }[]; thresholds: Record<string, number> };
  try {
    account = (await getServer(cfg).loadAccount(address)) as unknown as typeof account;
  } catch (e) {
    const err = e as { name?: string; response?: { status?: number } };
    if (err?.name === 'NotFoundError' || err?.response?.status === 404) return NOT_FUNDED;
    throw e;
  }
  const all = account.signers ?? [];
  const signers = all.filter((s) => s.key !== address && s.weight === SERVER_WEIGHT).map((s) => s.key);
  const thresholds = account.thresholds ?? {};
  const rightThresholds = (['low_threshold', 'med_threshold', 'high_threshold'] as const).every(
    (k) => Number(thresholds[k]) === DEVICE_WEIGHT,
  );
  const master = all.find((s) => s.key === address)?.weight ?? 0;
  return {
    exists: true,
    enabled: signers.length === RECOVERY_SERVER_COUNT && rightThresholds && master === DEVICE_WEIGHT,
    signers,
  };
}

/**
 * The signers to take off the account when recovery is turned off, asked of the SERVERS
 * rather than guessed from the ledger.
 *
 * `recoveryStateOf` recognises a recovery signer by its weight, which is fine for telling
 * the user whether recovery is on and wrong for deciding what to remove: any other signer
 * the account happens to carry at that weight — a co-signer, a service — would have been
 * zeroed along with them. Each server reports the key it holds for this account and only
 * that key is removed.
 *
 * It also DEREGISTERS the account, in the same pass: a server that keeps answering for an
 * account it can no longer sign for is holding an identity record for nothing.
 */
export async function signersToRemove(
  cfg: NetConfig,
  servers: readonly RecoveryServer[],
  address: string,
  secret: string,
): Promise<string[]> {
  const keys: string[] = [];
  for (const server of servers) {
    const token = await authenticate(cfg, server, address, secret);
    const account = await recoveryAccount(server.sep30Base, token, address);
    // A server that does not know the account has nothing on it to remove, and saying so
    // is not a failure: the other one may still be there, and that is the case worth
    // finishing rather than refusing.
    if (!account) continue;
    const key = account.signers[0]?.key;
    if (key) keys.push(key);
    await recoveryForget(server.sep30Base, token, address);
  }
  return keys;
}

/* -------------------------------- recovering --------------------------------- */

/**
 * How this person can prove their inbox to BOTH servers, or null when they cannot.
 *
 * `idToken` is Authentik's, handed over by the sign-in only after an emailed code proved
 * the inbox (see `SignInReady.idToken`). Each server verifies it against Authentik's keys
 * on its own, so it only helps with servers that name that same issuer. Without one — a
 * sign-in by emailed code, or through Google or GitHub directly — each server has to send
 * its OWN code instead, which is also the only way two servers ever each prove an inbox
 * without either one taking the other's word for it.
 */
export type IdentityRoute = { kind: 'oidc' } | { kind: 'email' };

export function identityRoute(servers: readonly RecoveryServer[], idToken: string | undefined): IdentityRoute | null {
  if (idToken && servers.every((s) => !!s.oidcIssuer)) return { kind: 'oidc' };
  if (servers.every((s) => s.emailCodes)) return { kind: 'email' };
  return null;
}

/**
 * An identity token from each server, from one Authentik login.
 *
 * One per server, and neither accepts the other's: that is not redundancy, it is the
 * property that makes two servers worth having. Each server takes a given ID token ONCE,
 * so the caller keeps what comes back for the whole recovery — listing and signing — and
 * never exchanges the same login twice.
 */
export async function identityTokensFromIdToken(
  servers: readonly RecoveryServer[],
  idToken: string,
): Promise<string[]> {
  const tokens: string[] = [];
  // Sequential, so a server that refuses stops the second exchange from spending the
  // token on the other one for nothing.
  for (const server of servers) tokens.push((await recoveryIdentityFromIdToken(server.sep30Base, idToken)).token);
  return tokens;
}

/** Ask each server to email its own code. Returns one claim token per server, in role order. */
export async function startRecoveryCodes(servers: readonly RecoveryServer[], email: string): Promise<string[]> {
  const claims: string[] = [];
  for (const server of servers) claims.push((await recoveryEmailStart(server.sep30Base, email.trim().toLowerCase())).claim_token);
  return claims;
}

/** Answer one server's code. The caller decides what `invalid` / `locked` mean on screen. */
export function verifyRecoveryCode(server: RecoveryServer, claimToken: string, code: string): Promise<RecoveryEmailResult> {
  return recoveryEmailVerify(server.sep30Base, claimToken, code);
}

/** An account that can actually be recovered, with each server's signer for it. */
export interface RecoverableAccount {
  address: string;
  /** One per server, in role order — what `collectSignatures` asks each one to sign as. */
  signers: string[];
}

/**
 * Every account one server lists for this identity, following SEP-30's cursor to the end.
 *
 * The listing is PAGED (`after` is the last address of the page before), and reading only
 * the first page is how someone is shown some of their accounts and told that is all of
 * them — a wallet missing from a recovery list looks exactly like a wallet that was never
 * protected, and the person has no way to tell which they are looking at.
 *
 * A server that ignores the cursor would page forever, so the walk stops on three terms:
 * an empty page, a page that adds nothing new, and a cap. Addresses are de-duplicated
 * because overlapping pages are the shape a cursor produces under concurrent writes.
 */
async function allAccountsOf(server: RecoveryServer, token: string): Promise<RecoveryAccount[]> {
  const seen = new Map<string, RecoveryAccount>();
  let after: string | undefined;

  for (let page = 0; page < RECOVERY_LIST_MAX_PAGES; page++) {
    const { accounts } = await recoveryAccounts(server.sep30Base, token, after);
    if (!accounts.length) break;
    const before = seen.size;
    for (const a of accounts) if (!seen.has(a.address)) seen.set(a.address, a);
    if (seen.size === before) break; // the same page again: the cursor is not moving
    after = accounts[accounts.length - 1].address;
  }
  return [...seen.values()];
}

/**
 * The accounts this identity may recover, as BOTH servers agree they are.
 *
 * The INTERSECTION, not the union: an account only one server knows about cannot be
 * recovered — one signature never reaches the threshold — so offering it would be offering
 * a button that fails at the last step, after the person has already been told their funds
 * are coming back. Each server's own signer travels with the row for the same reason it
 * was never a shared value: the two are different keys and only each server knows its own.
 */
export async function recoverableAccounts(
  servers: readonly RecoveryServer[],
  tokens: readonly string[],
): Promise<RecoverableAccount[]> {
  const lists = await Promise.all(servers.map((s, i) => allAccountsOf(s, tokens[i])));
  const signerIn = (accounts: RecoveryAccount[], address: string): string =>
    accounts.find((a) => a.address === address)?.signers[0]?.key ?? '';

  return lists[0]
    .map((a) => ({ address: a.address, signers: lists.map((l) => signerIn(l, a.address)) }))
    .filter((row) => row.signers.every((key) => key !== '') && new Set(row.signers).size === row.signers.length);
}

export interface ReplaceInput {
  /** The account being recovered — its address does not change, which is the point. */
  account: string;
  /** The key this device just generated. It becomes the account's new device key. */
  newKey: string;
  sequence: string;
  networkPassphrase: string;
}

/**
 * The transaction that moves an account onto a new device key.
 *
 * Built HERE, by the device that will use it, and only then handed to the servers for
 * signatures. A transaction built by a server and signed by the same server is a
 * transaction nobody independent ever read.
 *
 * Two operations, and the second is what makes it a recovery rather than an addition:
 * the new key goes on at the device's weight, and the old master key — the one on the
 * phone in the taxi — goes to zero. The recovery signers are left exactly as they are, so
 * the account can be recovered again from the next device too.
 */
export function buildKeyReplacement(input: ReplaceInput): string {
  const source = new Account(input.account, input.sequence);
  return new TransactionBuilder(source, {
    fee: String(Number(BASE_FEE) * 2),
    networkPassphrase: input.networkPassphrase,
    memo: Memo.none(),
  })
    .addOperation(Operation.setOptions({ source: input.account, signer: { ed25519PublicKey: input.newKey, weight: DEVICE_WEIGHT } }))
    .addOperation(Operation.setOptions({ source: input.account, masterWeight: 0 }))
    .setTimeout(RECOVERY_TIMEOUT_S)
    .build()
    .toXDR();
}

/**
 * Collect both servers' signatures onto one transaction.
 *
 * Each server returns a raw signature rather than an envelope, so this is where they are
 * put together — and where a server that returned a signature for a DIFFERENT transaction
 * is caught: `addSignature` verifies it against this transaction's hash and throws if it
 * does not hold. Both are required; one signature is half a threshold and submitting it
 * would burn the sequence number for nothing.
 */
export async function collectSignatures(
  cfg: NetConfig,
  servers: readonly RecoveryServer[],
  tokens: readonly string[],
  signers: readonly string[],
  address: string,
  xdr: string,
): Promise<string> {
  // The wallet's own network, as everywhere else: an envelope does not carry a passphrase,
  // and one taken from a counterparty is how a signature ends up valid somewhere else.
  const tx = TransactionBuilder.fromXDR(xdr, cfg.passphrase);
  for (const [i, server] of servers.entries()) {
    const { signature } = await recoverySign(server.sep30Base, tokens[i], address, signers[i], xdr);
    try {
      tx.addSignature(signers[i], signature);
    } catch {
      throw new RecoveryError('recovery.error.badSignature', { server: server.webAuthDomain });
    }
  }
  return tx.toXDR();
}
