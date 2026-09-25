/**
 * The wallet's own sign-in: Authentik, Google, GitHub or an emailed code — and the key
 * stays here. Served by the community server, through the gateway (`walletApiBase`).
 *
 * ## What replaced what
 *
 * The social login before this one handed the Stellar key to Pollar, which kept it in its
 * own KMS; the wallet could ask it to sign and nothing more. This one never lets the key
 * leave the device. A sign-in proves WHO someone is; the wallet then either generates a seed
 * (a new account) or restores the one it backed up last time (`lib/cloudBackup.ts`) — which
 * only the person's password opens. Pollar is still reachable, from one place: moving an old
 * Pollar wallet's funds onto a key this device holds (`lib/pollarMigration.ts`).
 *
 * ## The three steps
 *
 *  1. PROVE THE EMAIL. A provider (`openSignIn` → the browser → `waitForSignIn` →
 *     `claimSignIn`), or a code (`signInEmailStart` → `signInEmailVerify`). A provider
 *     sign-in for an email that already has an account ALSO ends in a code: the provider
 *     proves who consented, the inbox proves who opened the sign-in, and an existing account
 *     is where the backup worth stealing is. Ends in `ready`: the identity, whether an
 *     account exists, its backup, and a short-lived session token.
 *  2. `finishSignIn` — the token plus a signature by the key this device now holds. The
 *     server creates or links the account, keeps the backup, and returns the API keys.
 *  3. Later, `replaceBackup` — re-sealed under a new password, signed by the same key.
 *
 * ## The poll flow, and why the handshake is on disk
 *
 * The same shape the Pollar login used, for the same reason: this bundle runs as an MV3
 * popup, a side panel, a Tauri window and a web page, and only some of those can be
 * addressed by a redirect. So the provider sends the person to the server, and the wallet
 * asks the server whether they came back. Opening the consent screen closes an MV3 popup
 * — and every bit of React state with it — so the handshake is persisted before the browser
 * opens and a reopened wallet picks it up. It holds the PKCE verifier, which is what makes a
 * `state` seen in a browser worth nothing to anyone else.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { ApiRequestError } from '@/lib/apiError';
import { walletApiBase } from '@/lib/endpoints';
import { tNow } from '@/lib/i18n';
import { newPkce } from '@/lib/pkce';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';
import { isHttpsUrl } from '@/lib/validate';
import {
  putBackup,
  signInAuthorize,
  signInClaim,
  signInFinish,
  signInPoll,
  type SignInClaim,
  type SignInFinish,
} from '@/lib/cosmospay';
import {
  SIGN_IN_HANDSHAKE_KEY,
  SIGN_IN_POLL_INTERVAL_MS,
  SIGN_IN_POLL_TIMEOUT_MS,
  type SignInProvider,
} from '@/constants/signIn';

/** One open provider sign-in: what to poll, and what redeems it. */
export interface SignInHandshake {
  state: string;
  provider: SignInProvider;
  /** Never sent anywhere but the claim. It is what makes a seen `state` worthless. */
  verifier: string;
  /** Epoch ms. */
  startedAt: number;
}

/**
 * Why a sign-in stopped. `reason` is what the wallet branches on; `detail` is the
 * server's own code on `failed` (`denied`, `email_unverified`, …) and is only ever used
 * to pick a sentence, never compared against copy.
 */
export class SignInError extends Error {
  readonly reason: 'cancelled' | 'timeout' | 'expired' | 'failed';
  readonly detail: string | null;

  constructor(reason: SignInError['reason'], detail: string | null = null) {
    super(tNow(signInErrorKey(reason, detail)));
    this.name = 'SignInError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** The i18n key for a stopped sign-in. Exported so a test can pin the mapping. */
export function signInErrorKey(reason: SignInError['reason'], detail: string | null): string {
  if (reason === 'failed' && detail === 'email_unverified') return 'signin.error.emailUnverified';
  if (reason === 'failed' && detail === 'denied') return 'signin.error.denied';
  return `signin.error.${reason}`;
}

/* ------------------------------- handshake ------------------------------- */

/**
 * Open a provider sign-in: mint the PKCE pair, ask the server for the URL, and refuse a
 * URL that is not https before it gets anywhere near the OS opener — this is the boundary
 * where a string from the network becomes a launched program.
 */
export async function openSignIn(
  provider: SignInProvider,
  accessKey: string | null = null,
): Promise<{ authorizationUrl: string; handshake: SignInHandshake }> {
  const pkce = await newPkce();
  const opened = await signInAuthorize(
    { provider, codeChallenge: pkce.challenge, codeChallengeMethod: pkce.method },
    accessKey,
  );
  if (!isHttpsUrl(opened.authorizationUrl)) {
    throw new ApiRequestError(
      `${walletApiBase()}/auth/oauth/authorize`,
      502,
      'bad_authorization_url',
      tNow('signin.error.badUrl'),
    );
  }
  return {
    authorizationUrl: opened.authorizationUrl,
    handshake: { state: opened.state, provider, verifier: pkce.verifier, startedAt: Date.now() },
  };
}

export async function saveSignInHandshake(hs: SignInHandshake): Promise<void> {
  await storageSet(SIGN_IN_HANDSHAKE_KEY, JSON.stringify(hs));
}

/** The handshake a closed popup left behind, or null — a stale one is dropped on read. */
export async function loadSignInHandshake(now = Date.now()): Promise<SignInHandshake | null> {
  const raw = await storageGet(SIGN_IN_HANDSHAKE_KEY);
  if (!raw) return null;
  try {
    const hs = JSON.parse(raw) as SignInHandshake;
    if (typeof hs.state !== 'string' || typeof hs.verifier !== 'string' || typeof hs.startedAt !== 'number') return null;
    if (now - hs.startedAt > SIGN_IN_POLL_TIMEOUT_MS) {
      await clearSignInHandshake();
      return null;
    }
    return hs;
  } catch {
    return null;
  }
}

export async function clearSignInHandshake(): Promise<void> {
  await storageRemove(SIGN_IN_HANDSHAKE_KEY);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait for the person to come back from the provider.
 *
 * Returns when the server says `authorized` — it never returns an identity, which only
 * the claim hands over. Every other status ends the wait with the reason; a 429 is the only
 * failure waited out, for as long as the server asked. Past the deadline the wallet stops
 * on its own rather than meeting the server's expiry.
 */
export async function waitForSignIn(
  handshake: SignInHandshake,
  shouldStop: () => boolean,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  // `accessKey` is the SECOND argument rather than a closed-over one so the
  // injected poll in tests keeps its position. A stub that ignores it still
  // matches, which is what keeps this seam cheap.
  poll: (state: string, accessKey?: string | null) => Promise<{ status: string; error?: string }> = signInPoll,
  accessKey: string | null = null,
): Promise<void> {
  const deadline = handshake.startedAt + SIGN_IN_POLL_TIMEOUT_MS;
  for (;;) {
    if (shouldStop()) throw new SignInError('cancelled');
    if (Date.now() > deadline) throw new SignInError('timeout');

    let res: { status: string; error?: string };
    try {
      res = await poll(handshake.state, accessKey);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 429) {
        const after = 'retryAfterMs' in e ? (e as { retryAfterMs: number | null }).retryAfterMs : null;
        await sleep(Math.max(after ?? SIGN_IN_POLL_INTERVAL_MS, SIGN_IN_POLL_INTERVAL_MS));
        continue;
      }
      throw e;
    }

    if (res.status === 'authorized') return;
    if (res.status === 'failed') throw new SignInError('failed', res.error ?? null);
    if (res.status !== 'pending') throw new SignInError('expired');
    await sleep(SIGN_IN_POLL_INTERVAL_MS);
  }
}

/** Redeem a handshake the server reported `authorized`. */
export async function claimSignIn(
  handshake: SignInHandshake,
  accessKey: string | null = null,
): Promise<Exclude<SignInClaim, { status: 'pending' | 'failed' | 'expired' }>> {
  const res = await signInClaim({ state: handshake.state, codeVerifier: handshake.verifier }, accessKey);
  if (res.status === 'failed') throw new SignInError('failed', res.error);
  if (res.status === 'expired' || res.status === 'pending') throw new SignInError('expired');
  return res;
}

/* ------------------------------- signatures ------------------------------ */

/**
 * The finish challenge. Must match the community server byte for byte (`finishMessage` in
 * its wallet-auth-core module), and both sides pin the same literal in their tests.
 */
export function finishMessage(email: string, stellarAddress: string, signedAt: string): string {
  return (
    `Cosmos Pay Wallet sign-in\n` +
    `email: ${email.trim().toLowerCase()}\n` +
    `account: ${stellarAddress}\n` +
    `at: ${signedAt}`
  );
}

const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** The backup-replacement challenge. It covers the box's hash, so one signature stores one box. */
export async function backupMessage(stellarAddress: string, box: string, signedAt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(box));
  return `Cosmos Pay Wallet backup\naccount: ${stellarAddress}\nbox: ${hex(digest)}\nat: ${signedAt}`;
}

/**
 * Sign a challenge's UTF-8 bytes. Only for the two fixed-format challenges above, each
 * starting with a line no transaction can — never for bytes a caller supplies (that is
 * `lib/signMessage.ts`, which signs a digest for exactly that reason).
 */
function signChallenge(secret: string, message: string): string {
  return Buffer.from(Keypair.fromSecret(secret).sign(Buffer.from(message, 'utf8'))).toString('base64');
}

/**
 * Step 2: attach the proven email to the key this device holds.
 *
 * `backup` goes with it when there is one to keep (a new wallet); a restore sends none,
 * since the server already holds the box it just handed back. `replaceBackup` is only
 * ever true after the person was shown what they are replacing — see the store.
 */
export async function finishSignIn(input: {
  sessionToken: string;
  email: string;
  secret: string;
  /**
   * The account to link, when it is not the signing key's own address.
   *
   * Only a RECOVERED wallet passes this: SEP-30 recovery puts a new key on an account and
   * retires the old master, so the address stops being derivable from the key that signs
   * for it. The server accepts the signature because that key is one of the account's
   * current signers — see the community server's account-signers module, in its own
   * repository. Every other caller leaves it
   * off and gets the key's own address, which is the only safe default.
   */
  account?: string;
  backup?: string;
  replaceBackup?: boolean;
  /** Presented only when the community server serves the sign-in — see `signInHeaders`. */
  accessKey?: string | null;
}): Promise<SignInFinish> {
  const stellarAddress = input.account ?? Keypair.fromSecret(input.secret).publicKey();
  const signedAt = new Date().toISOString();
  return signInFinish(input.sessionToken, {
    stellarAddress,
    signedAt,
    signature: signChallenge(input.secret, finishMessage(input.email, stellarAddress, signedAt)),
    ...(input.backup !== undefined ? { backup: input.backup } : {}),
    ...(input.replaceBackup ? { replaceBackup: true } : {}),
  },
  input.accessKey ?? null);
}

/** Step 3: store a re-sealed box. The signature by the box's own key is the credential. */
export async function replaceBackup(input: {
  secret: string;
  box: string;
  account?: string;
  accessKey?: string | null;
}): Promise<void> {
  // `account` for a recovered wallet, exactly as in `finishSignIn` above.
  const stellarAddress = input.account ?? Keypair.fromSecret(input.secret).publicKey();
  const signedAt = new Date().toISOString();
  await putBackup(
    {
      stellarAddress,
      box: input.box,
      signedAt,
      signature: signChallenge(input.secret, await backupMessage(stellarAddress, input.box, signedAt)),
    },
    input.accessKey ?? null,
  );
}
