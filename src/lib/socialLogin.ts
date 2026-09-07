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
 * A social login always runs against `prod`, whatever network the wallet is showing.
 *
 * Two different questions were being answered by one variable, and the wallet's default
 * network — testnet — made the wrong answer the common one. They are:
 *
 *  - **Which Pollar app and which CosmosPay account is this?** Always the mainnet one. An
 *    account with Google is a real account belonging to a real person: it is created once
 *    from an email a provider verified, and the claim mints BOTH keys (`keys.dev` and
 *    `keys.prod`) for it, so it serves either network afterwards. Opening it against
 *    Pollar's testnet app would make a second, throwaway identity for the same person,
 *    and a fresh install would get that one by accident simply because nobody had
 *    switched the network yet.
 *  - **Who holds the Stellar key?** That one IS the wallet's current network, and it is
 *    decided in `state/store.ts` by `networkEnv(network)` — Pollar custodies on mainnet,
 *    the device generates a seed anywhere else.
 *
 * Keeping them apart is the whole point of this constant. `authorize`, the poll and the
 * claim must all use the same value: the handshake is scoped to the consumer and network
 * that opened it, so a poll under a different env is an unknown handshake.
 */
export const SOCIAL_LOGIN_ENV: SocialEnv = 'prod';

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
 *
 * `stellarAddress` is the public half of a key THIS DEVICE generated, and it is what
 * makes the testnet flow work: the account and its API keys are registered against it
 * instead of against the address Pollar custodies, and the platform skips the funding
 * that only a custodied wallet needs. Left out on mainnet, where the wallet has no key
 * of its own to name. See `state/store.ts`'s `finishSocialLogin` for who decides.
 */
export function socialLoginClaim(
  env: SocialEnv,
  handshake: PollarHandshake,
  code: string,
  name?: string,
  stellarAddress?: string,
): Promise<SocialClaim> {
  return socialClaim(env, {
    code,
    codeVerifier: handshake.verifier,
    ...(name ? { name } : {}),
    ...(stellarAddress ? { stellarAddress } : {}),
  });
}
