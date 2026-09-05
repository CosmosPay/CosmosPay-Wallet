/**
 * "Continue with Google" for a wallet that has nothing yet — no seed, no account, no key.
 *
 * ## Why this is not `lib/pollar.ts`
 *
 * That module talks to the gateway's Pollar bridge with the wallet's own CosmosPay API
 * key. This one exists because on a first run there is no such key, and there cannot be:
 * a key belongs to an account, an account was created from an email round trip started by
 * signing a nonce with a Stellar secret, and a social wallet has no secret to sign with —
 * Pollar custodies that key. Social login was therefore only reachable from a wallet that
 * had already been provisioned some other way, which is close to the opposite of what a
 * social login is for.
 *
 * So the dev platform runs the handshake instead, with its own identity, and this module
 * is the client for that. The alternative — shipping a bootstrap API key inside a public
 * app bundle — was rejected: `pollar:write` funds Stellar accounts out of the operator's
 * XLM, and a credential in a public bundle is a credential everyone has.
 *
 * ## What the wallet still holds
 *
 * The PKCE verifier, and it is the whole security of the flow. The platform's poll route
 * will show the single-use code to anyone who knows the `state`; only the holder of the
 * verifier can redeem it. It is generated here, kept in the handshake that
 * `lib/pollarSession.ts` persists (unsealed on purpose — there is no vault key yet on a
 * first run), and sent exactly once, at redemption.
 *
 * ## What comes back
 *
 * Both halves at once: the Pollar session the wallet signs with, and the CosmosPay keys
 * it needs for swaps and fiat. From that point the wallet is an ordinary provisioned
 * wallet and everything else — refresh, logout, signing — goes through the normal paths
 * with its own key.
 */
import { socialAuthorize, socialClaim, socialStatus, type SocialClaim } from '@/lib/cosmospay';
import { ApiRequestError } from '@/lib/apiError';
import { devPlatformUrl } from '@/lib/endpoints';
import { tNow } from '@/lib/i18n';
import { newPkce } from '@/lib/pkce';
import { isHttpsUrl, type PollarHandshake, type PollarSessionStatus } from '@/lib/pollar';
import type { PollarProvider } from '@/constants/pollar';

/** Which environment's keys and Pollar network a login runs against. */
export type SocialEnv = 'dev' | 'prod';

/**
 * Open a login and return the URL to send the user to, plus the handshake to keep.
 *
 * Same two-value shape as `pollarAuthorize`, and the same https check on the URL before
 * it reaches the OS opener — the URL was built by our own platform either way, and the
 * point of the check is not distrust but that this is the boundary where a string becomes
 * a launched program.
 */
export async function socialLoginStart(
  env: SocialEnv,
  provider: PollarProvider,
  deviceLabel?: string,
): Promise<{ authorizationUrl: string; handshake: PollarHandshake }> {
  const pkce = await newPkce();
  const opened = await socialAuthorize(env, {
    provider,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: pkce.method,
    ...(deviceLabel ? { deviceLabel } : {}),
  });

  if (!isHttpsUrl(opened.authorizationUrl)) {
    throw new ApiRequestError(
      `${devPlatformUrl()}/api/wallet/social/authorize`,
      502,
      'bad_authorization_url',
      tNow('pollar.badUrl'),
    );
  }

  return {
    authorizationUrl: opened.authorizationUrl,
    // `brokered` is set HERE rather than by the caller: it is what a resume reads to
    // decide who to poll, and a caller that forgot it would resume against the gateway
    // with a key that never opened this handshake.
    handshake: { state: opened.state, provider, verifier: pkce.verifier, startedAt: Date.now(), brokered: true },
  };
}

/**
 * The poller to hand to `waitForCode`.
 *
 * A function of `env` returning a function of `state`, so the wait loop stays the one in
 * `lib/pollar.ts` — the timeout, the 429 pause and which statuses are terminal are rules
 * worth having exactly once.
 */
export function socialPoller(env: SocialEnv): (state: string) => Promise<PollarSessionStatus> {
  return (state) => socialStatus(env, state);
}

/**
 * Redeem the code. Single-use: it is spent whether or not this resolves, so a failure
 * here means starting a new handshake, never retrying with the same code.
 *
 * `name` is only a fallback for the display name — the provider profile wins when it
 * carries one.
 */
export function socialLoginClaim(
  env: SocialEnv,
  handshake: PollarHandshake,
  code: string,
  name?: string,
): Promise<SocialClaim> {
  return socialClaim(env, { code, codeVerifier: handshake.verifier, ...(name ? { name } : {}) });
}
