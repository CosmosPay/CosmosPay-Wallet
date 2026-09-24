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
 * The same three numbers are declared by each recovery server (its own `recovery-setup`
 * module, in the dev-platform repository) and by the wallet here. They are NOT shared
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
 * XLM an account needs spare to pay for recovery itself: 0.5 per signer entry, plus a
 * little for the fee.
 *
 * Below this the account cannot turn recovery on with its own lumens, and the operator's
 * sponsored path is the only one that works — which is most accounts on a first run, and
 * the reason that path exists at all.
 */
export const RECOVERY_RESERVE_XLM = RECOVERY_SERVER_COUNT * 0.5 + 0.01;
