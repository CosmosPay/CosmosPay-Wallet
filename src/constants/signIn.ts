/**
 * The wallet's own sign-in — Authentik, Google, GitHub or an emailed code. Data only; the
 * protocol is `src/lib/signIn.ts` and the backup it restores is `src/lib/cloudBackup.ts`.
 *
 * The numbers here are the wallet's half of a contract whose other half is the community
 * server's wallet-auth constants module (a separate repository, so named rather than
 * linked). Where both name the same fact the server is authoritative and this file stays
 * inside it.
 */

/**
 * The providers the server can run, in the order they are shown. Which of them a deployment
 * OFFERS comes from `GET /v1/wallet/auth/providers` — this list is only what the wallet
 * knows how to show.
 *
 * `authentik` first: it is the operator's own OpenID Connect provider, with Google and
 * GitHub behind it as sources, MFA, and an ID token the recovery servers can verify on
 * their own. The direct Google and GitHub doors remain for a deployment that has no
 * Authentik.
 */
export const SIGN_IN_PROVIDERS = ['authentik', 'google', 'github'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/** How a sign-in proved the email. `email` is a code typed from the inbox. */
export type SignInMethod = SignInProvider | 'email';

/** Where a sign-in has got to — see `src/state/useSignIn.ts`. */
export type SignInPhase = 'idle' | 'opening' | 'waiting' | 'claiming' | 'code' | 'verifying';

/** What a deployment offers, from `GET /v1/wallet/auth/providers`. */
export interface SignInOffer {
  providers: SignInProvider[];
  email: boolean;
}

/**
 * Gap between polls while the consent screen is open in another window. A person reading a
 * consent screen takes tens of seconds, and every poll is a round trip from a phone.
 */
export const SIGN_IN_POLL_INTERVAL_MS = 2000;

/**
 * How long the wallet waits for the person to come back before giving up on its own —
 * under the server's ten-minute handshake lifetime, so the wallet stops with copy it
 * wrote instead of meeting an `expired` it could have predicted.
 */
export const SIGN_IN_POLL_TIMEOUT_MS = 9 * 60 * 1000;

/**
 * Where an open handshake waits while the consent screen is up. Unsealed on purpose: it
 * exists before any vault does, and it is worthless on its own — the server hands the
 * identity only to the holder of the verifier, and the verifier never leaves the device.
 * It has to be on disk at all because on MV3 opening the consent screen closes the popup.
 */
export const SIGN_IN_HANDSHAKE_KEY = 'cosmos.signin.handshake';
