/** Gateway transport tunables. Data only — the transport itself is in src/lib/cosmospay.ts. */

/**
 * Page size for every list read.
 *
 * The gateway clamps `take` at 100 and every list the wallet reads now defaults to
 * that ceiling, so asking for it explicitly changes no response — it makes the bound
 * visible at the call site instead of leaving "how many receivers can this user have"
 * as a fact only the server knows. `total` comes back alongside, which is what lets a
 * caller tell a full page from the last one; `data.length` cannot, because on a full
 * page it always equals `take`.
 */
export const PAGE_SIZE = 100;

/**
 * The longest `Retry-After` the wallet will honour, in seconds.
 *
 * Not a policy about how patient the user is — a bound on how far a header can park
 * the next attempt. An hour is far past any real budget window (the Pollar ones are
 * ten minutes), so anything above this is a misconfiguration or a hostile proxy, and
 * clamping turns "the wallet stopped talking to the gateway" into "the wallet retried
 * early and was refused again", which at least says so.
 */
export const RETRY_AFTER_CAP_S = 3600;
