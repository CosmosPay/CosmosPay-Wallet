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

/**
 * One of Authentik's own sources (Google, GitHub…), offered as a button of its own: the
 * sign-in starts at that source instead of Authentik's login page, and comes back through
 * Authentik like any other (`source` on `POST /v1/wallet/auth/oauth/authorize`).
 */
export interface SignInSource {
  /** The source's slug, sent back as `source`. */
  id: string;
  /** The provider's own name, for the button. */
  name: string;
}

/** A source id as the community server accepts one: lowercase, digits, dashes. */
export const SIGN_IN_SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,49}$/;

/**
 * The Authentik source that signs in by EMAIL (a sign-in link Authentik sends). When the server
 * lists it, it is the email button — the in-app code is not offered beside it — because its
 * login proves the inbox AND carries the ID token the recovery servers accept: one email, and
 * the backup opens with no password.
 */
export const EMAIL_SOURCE_ID = 'email';

/** What a deployment offers, from `GET /v1/wallet/auth/providers`. */
export interface SignInOffer {
  providers: SignInProvider[];
  /**
   * Authentik's sources, when the deployment lists them. With these the wallet shows one
   * button per source and no generic Authentik ("Cosmos Pay") button; without them, the
   * Authentik button opens its login page, where the person picks.
   */
  sources: SignInSource[];
  email: boolean;
  /**
   * The page of the person's Cosmos Pay (Authentik) account where they add or remove a
   * second factor — security key or passkey, authenticator app, recovery codes. Optional
   * by design — the sign-in only offers one — so Settings links here. Null without
   * Authentik, or when the server sent something that is not https.
   */
  mfaSettingsUrl: string | null;
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

/**
 * PKCE (RFC 7636) for the sign-in handshake (`lib/pkce.ts`). S256 only — `plain` protects
 * nothing across a redirect, and the community server refuses anything else anyway.
 *
 * 64 bytes of entropy: the spec allows a 43-128 character verifier, base64url of 64 bytes
 * lands at 86, and there is no reason to sit at the floor for a value that exists to make a
 * leaked handshake useless.
 */
export const PKCE_METHOD = 'S256';
export const PKCE_VERIFIER_BYTES = 64;

/**
 * The page the community server's callback sends the browser to after a sign-in opened from
 * the web build (`returnTo`), under the build's base URL: `src/pages/signed-in.astro`. It must
 * be listed in the server's `WALLET_AUTH_RETURN_URLS` (an unlisted one is refused, and the
 * wallet then signs in without it). After Authentik's emailed link it carries the device
 * binding, which only the wallet in that browser can read.
 */
export const SIGN_IN_RETURN_PATH = 'signed-in/';

/** The server's error code for a `returnTo` it does not list: the sign-in then goes without one. */
export const SIGN_IN_RETURN_REFUSED = 'wallet_return_url_not_allowed';

/**
 * How long the return page waits before closing its tab: the binding it just wrote reaches the
 * other tabs first.
 */
export const SIGN_IN_RETURN_CLOSE_MS = 300;

/**
 * Where the return page leaves a device binding for the tab that holds the handshake, one key
 * per `state`, in `localStorage` (shared by the tabs of one browser, which is the point: a
 * wallet in another browser never sees it). Read and removed by the claim.
 */
export const SIGN_IN_BINDING_KEY_PREFIX = 'cosmos.signin.binding.';

/** A binding nobody claimed is dropped after this — longer than any handshake lives. */
export const SIGN_IN_BINDING_TTL_MS = 15 * 60 * 1000;

/**
 * How long a claim waits for the binding once the poll says one was sent (`bound`): the
 * return page loads a moment after the server marks the handshake. If it never comes — the
 * link was opened in another browser — the claim goes ahead without it and the server
 * emails its own code.
 */
export const SIGN_IN_BINDING_WAIT_MS = 8000;

/** How often the wait looks again, beside the `storage` event that normally ends it. */
export const SIGN_IN_BINDING_POLL_MS = 250;
