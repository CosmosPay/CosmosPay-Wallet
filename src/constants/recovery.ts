/**
 * SEP-30 account recovery: the shape of the account it produces. Data only — the protocol
 * is `src/lib/recovery.ts`, the challenge check is `src/lib/sep10.ts`, and what the wallet
 * will actually sign is the `recovery` intent in `src/lib/txGuard.ts`.
 *
 * ## What recovery is for, and what it is not
 *
 * A wallet whose seed lives only on the device is lost with the device. The encrypted
 * cloud backup (`src/lib/cloudBackup.ts`) answers that for someone who remembers their
 * password; this answers it for someone who does not — the account itself gets two extra
 * signers, held by two servers, and they co-sign a new device key onto it.
 *
 * It is OPT-IN and it replaces nothing. A local wallet stays a local wallet; nothing here
 * runs until the person turns it on, and turning it off is theirs to do as well.
 *
 * ## The weights, which are the whole design
 *
 *     device (10)          ≥ threshold (10)  → normal use needs nobody else
 *     server a (5) + b (5) ≥ threshold (10)  → recovery needs BOTH servers
 *     one server alone (5) <  threshold (10) → one server can do nothing
 *
 * The same three numbers are declared by the operator's sponsored builder (the community
 * server's wallet-auth constants, a separate repository) and by the wallet here. They are NOT shared
 * through an API on purpose: a server that could tell the wallet what weights to accept
 * could tell it to accept a weight that makes the server sufficient alone. This copy is
 * what the guard checks the server's envelope against, so drift is a refusal.
 */

/** The device key's weight, and the threshold every operation on the account must reach. */
export const DEVICE_WEIGHT = 10;

/** Each recovery server's weight: half, so the two together are exactly enough. */
export const SERVER_WEIGHT = 5;

/**
 * How many servers hold a share. Two, and the guard enforces exactly two — a setup
 * carrying one signer would be a server that can act alone, and three would mean one the
 * user never agreed to.
 */
export const RECOVERY_SERVER_COUNT = 2;

/** SEP-30 identity roles exist; the wallet only ever registers the owner. */
export const IDENTITY_ROLE_OWNER = 'owner';

/** Which of the two deployments a base URL is. Carried so a failure can name the server. */
export const RECOVERY_ROLES = ['a', 'b'] as const;
export type RecoveryRole = (typeof RECOVERY_ROLES)[number];

/**
 * Seconds a setup or recovery transaction stays signable. Matches the servers' own
 * `SETUP_TIMEOUT_S`; the guard's generic window rules apply on top, so the effective
 * ceiling is whichever is smaller.
 */
export const RECOVERY_TIMEOUT_S = 300;

/**
 * How many stale keys one key replacement may zero. The recovery servers co-sign at most
 * eight operations (`RECOVERY_SIGN_MAX_OPS` on the community server); a replacement spends
 * two on the new key and the master, which leaves six. An account carrying more than that
 * is not one this wallet set up, and is refused rather than half-cleaned.
 */
export const RECOVERY_MAX_REVOKE = 6;

/**
 * How many pages of `GET /accounts` the wallet will follow before it stops.
 *
 * SEP-30 pages that listing with an `after` cursor and sets no page size, so the walk is
 * open-ended by construction; this bounds it. A server that ignored the cursor would
 * otherwise page forever, and the two cheaper stops — an empty page, a page that adds
 * nothing new — are what actually end the walk on a working server. One identity's
 * recoverable accounts is a handful, so this is a ceiling nobody reaches, not a limit.
 */
export const RECOVERY_LIST_MAX_PAGES = 20;

/**
 * XLM the two signer entries lock on the account: Stellar's base reserve, 0.5 per entry.
 * Locked, not spent — it is free again the moment recovery is turned off.
 */
export const RECOVERY_RESERVE_XLM = RECOVERY_SERVER_COUNT * 0.5;

/**
 * Spare XLM left over AFTER the reserve, on the path where the account pays for recovery
 * itself. A reserve that took the last free lumen would leave an account unable to pay the
 * fee on anything it does next, turning recovery off included. Below this the operator's
 * sponsored path is what gets offered, when the deployment runs one.
 */
export const RECOVERY_FEE_MARGIN_XLM = 0.5;

/** Free XLM an account needs before recovery can be turned on: the reserve plus the margin. */
export const RECOVERY_MIN_SPENDABLE_XLM = RECOVERY_RESERVE_XLM + RECOVERY_FEE_MARGIN_XLM;

/** The setup transaction's operation count: one per server signer, then the thresholds. */
export const RECOVERY_SETUP_OPS = RECOVERY_SERVER_COUNT + 1;

/**
 * How long the wallet keeps a recovery's identity tokens before asking again.
 *
 * Each server issues its identity token for thirty minutes; this stays five under it, so a
 * token the wallet still holds is never one the server has already stopped accepting — a
 * refusal on the SIGNING call, after the person has picked an account and typed a new
 * password, would be the worst moment to find out.
 */
export const RECOVERY_PROOF_TTL_MS = 25 * 60 * 1000;

/**
 * localStorage prefix for "not now" on the Home card that offers recovery
 * (`features/wallet/ProtectAccountCard.tsx`), suffixed with the account address. Per
 * account because the offer is about an account; a preference, so browser storage.
 */
export const RECOVERY_OFFER_DISMISSED_PREFIX = 'cosmos.recoveryOffer.dismissed.';

/**
 * How long a "the recovery servers did not answer" is believed (`recoveryReachable` in
 * `lib/recovery.ts`). A minute: long enough that every screen asking in one visit shares the
 * answer, short enough that a server that was only restarting is offered again soon.
 */
export const RECOVERY_PROBE_RETRY_MS = 60_000;

/**
 * The key a backup's email-recovery door is sealed under, and each server's half of it
 * (`lib/backupRecovery.ts`): an AES-256 key, split by XOR, so both halves are this size too.
 * The recovery servers refuse a half of any other length.
 */
export const BACKUP_RECOVERY_KEY_BYTES = 32;
