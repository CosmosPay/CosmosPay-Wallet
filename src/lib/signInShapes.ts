/**
 * Response contracts for the wallet's own sign-in (`/v1/wallet/auth/*` and
 * `PUT /v1/wallet/backup` on the community server). See `lib/apiShape.ts` for why every response has one.
 *
 * What is asserted is what the wallet acts on: the `state` it polls and puts back in a URL,
 * the `sessionToken` it presents, the backup `box` it decrypts and the address it checks the
 * result against, and the keys it stores. `status` is always the discriminant, because every
 * branch in `lib/signIn.ts` and the store is taken on it.
 */
import { account, arrayOf, bool, id, nullable, num, object, optional, str, variant } from '@/lib/apiShape';

export const SignInProvidersShape = object({
  providers: arrayOf(str),
  // Authentik's own sources (Google, GitHub…), each a button of its own. Absent on a
  // server older than the field, which the wallet answers with one Authentik button.
  sources: optional(arrayOf(object({ id: str, name: str }))),
  email: bool,
  // Absent on a server older than the field; null on a deployment with no Authentik.
  // Checked as https before it reaches the OS opener — see `mfaSettingsLink`.
  mfaSettingsUrl: optional(nullable(str)),
});

export const SignInAuthorizationShape = object({
  state: id,
  // Checked again as https before it reaches the OS opener — see `lib/signIn.ts`.
  authorizationUrl: str,
  expiresAt: str,
});

export const SignInPollShape = variant('status', {
  pending: object({}),
  // `bound`: the callback sent this browser's return page a device binding to claim with.
  // Absent on a server older than the field, and on every sign-in but Authentik's email link.
  authorized: object({ bound: optional(bool) }),
  redeemed: object({}),
  expired: object({}),
  failed: object({ error: str }),
});

const Identity = object({
  email: id,
  name: nullable(str),
  avatar: nullable(str),
  method: str,
});

const Ready = object({
  identity: Identity,
  account: str,
  backup: nullable(object({ stellarAddress: account, box: id, updatedAt: str })),
  // Every wallet the account keeps a backup of (servers from the per-wallet backups on).
  // `str`, not `account`: a Solana or Monad box names an address that is not a G…, and one
  // such row must not fail the whole sign-in — the wallet filters by chain instead.
  backups: optional(arrayOf(object({ chain: optional(str), stellarAddress: str, box: id, updatedAt: str }))),
  sessionToken: id,
  expiresInSeconds: num,
  // Asserted when present: the wallet hands it on to the recovery servers.
  idToken: optional(id),
});

export const SignInClaimShape = variant('status', {
  ready: Ready,
  verify_email: object({ claimToken: id, expiresInSeconds: num, email: str }),
  pending: object({}),
  failed: object({ error: str }),
  expired: object({}),
});

export const SignInCodeSentShape = object({ claimToken: id, expiresInSeconds: num });

export const SignInCodeResultShape = variant('status', {
  ready: Ready,
  invalid: object({ attemptsLeft: num }),
  expired: object({}),
  locked: object({}),
});

export const SignInFinishShape = variant('status', {
  ready: object({
    account: str,
    organizationId: str,
    keys: object({ dev: nullable(str), prod: nullable(str) }),
  }),
  backup_conflict: object({ stellarAddress: account }),
});

export const BackupUpdatedShape = object({ status: str });
