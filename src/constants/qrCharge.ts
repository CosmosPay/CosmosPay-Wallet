/**
 * Charging with a QR in local money (screen `charge`, `src/features/fiat/Charge.tsx`; rules in
 * `src/lib/qrCharge.ts`). The seller shows a QR for an amount in local money; whoever scans it
 * pays with a local method through the same P2P purchase the ramp opens, and the token lands in
 * this wallet's own EVM account. The API keeps the request (`/v1/onramp/p2p/payment-requests`);
 * the marketplace is never named in the wallet's copy.
 */

/** What the API says of a request. An open request past its expiry reads as `expired`. */
export const CHARGE_STATUSES = ['open', 'paid', 'expired', 'cancelled'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** The description the payer sees: one line, at most this many characters (the API's cap). */
export const CHARGE_DESCRIPTION_MAX = 140;

/** How long a QR can be paid, in minutes: a day, the API's own default (it takes 5 to 43,200). */
export const CHARGE_EXPIRES_MINUTES = 1440;

/** The request is asked about this often while the screen is in view. */
export const CHARGE_POLL_MS = 5_000;

/** The wallet's own balance of the token is read this often while the screen is in view (public nodes). */
export const CHARGE_BALANCE_POLL_MS = 10_000;

/**
 * The share of the estimate a rise in the balance must reach to count as the payment, in basis
 * points: the estimate is the market price when the QR was made, and the firm price the payer
 * gets a few minutes later can be a little lower.
 */
export const CHARGE_PAID_SHARE_BPS = 9_500;

/**
 * A charge that expired or was cancelled is still watched this long afterwards: a payer who
 * opened the payment just before is still paying, and that money arrives all the same.
 */
export const CHARGE_LATE_WATCH_MS = 30 * 60_000;

/** Storage key prefix of the charge on screen, per wallet and mode (`cosmos.charge.<wallet>.<mode>`). */
export const CHARGE_STORAGE_PREFIX = 'cosmos.charge';
