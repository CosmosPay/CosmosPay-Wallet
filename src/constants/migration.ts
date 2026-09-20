/**
 * Moving a Pollar wallet's funds onto a key this device holds — the numbers
 * `src/lib/pollarMigration.ts` plans with. Data only.
 */

/**
 * The network's base reserve, in stroops: 0.5 XLM per base entry and per subentry.
 *
 * A protocol constant that has not moved since 2019, and read here rather than from the
 * ledger for that reason: the plan is shown to the person BEFORE anything is signed, and
 * the guard then bounds every transaction by that plan. If the network ever changed it the
 * failure is loud and safe — the first transaction bounces on-chain for an underfunded
 * reserve, and nothing has moved.
 */
export const BASE_RESERVE_STROOPS = 5_000_000n;

/**
 * What the new account keeps above its own reserve when it is created, in stroops.
 *
 * It pays for its own trustline transaction out of its starting balance, and the fee the
 * plan computed is a floor under congestion rather than a ceiling. 0.05 XLM covers any
 * surge a transaction of a few operations will meet, and it is not lost: the last
 * transaction sends every remaining lumen to the same account.
 */
export const TARGET_MARGIN_STROOPS = 500_000n;

/**
 * Validity window of each migration transaction, in seconds. Under the guard's 15-minute
 * ceiling; long enough for Pollar to answer on a slow connection.
 */
export const MIGRATION_TX_TIMEOUT_S = 300;
