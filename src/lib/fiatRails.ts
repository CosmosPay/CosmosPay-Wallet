/**
 * Rail lookups that resolve copy, so they cannot live in `constants/` — that folder is
 * data and may not import the translator at runtime (CLAUDE.md, "Constants live in
 * `constants/`"). The tables stay there; the two functions that read them are here.
 */
import { RAILS, RAIL_CCY } from '@/constants/fiat';
import { tNow } from '@/lib/i18n';

/**
 * Human label for a saved bank account's rail type. Null-safe, and falls back to the
 * upper-cased raw type rather than to an empty string: a rail the tables do not know
 * is still something the user should be able to read off the screen.
 */
export function railLabel(type?: string | null): string {
  if (!type) return '';
  const rail = RAILS.find((r) => r.type === type);
  return rail ? tNow(rail.labelKey) : type.replace(/_/g, ' ').toUpperCase();
}

/** ISO currency for a rail / payin method (used as the fiat amount suffix). */
export function railCurrency(rail?: string | null): string {
  return rail ? RAIL_CCY[rail] ?? '' : '';
}

/**
 * Which rails the platform actually offers, read from `GET /v1/kyc/rails`.
 *
 * The point of this function is to move "which countries can deposit" out of a wallet
 * release. `constants/fiat.ts` has shipped that list hardcoded, so an operator enabling
 * a new rail in their dashboard had to wait for a build to clear two app stores and MV3
 * review before any user could use it.
 *
 * **This is the one place the undocumented shape is guessed, deliberately.** The route
 * is a BlindPay passthrough and BlindPay publishes a result code but not a content
 * shape, so the contract in `cosmospayShapes.ts` is `unchecked` on purpose: a guessed
 * schema there would turn an unfamiliar response into an `ApiShapeError` that takes the
 * whole deposit screen down. Here an unfamiliar response returns null instead, and the
 * caller keeps the table it shipped with — which is exactly today's behaviour, so the
 * worst case of this feature is the status quo.
 *
 * Three encodings are recognised, because all three are shapes this kind of endpoint
 * plausibly returns and telling them apart costs nothing:
 *   - `["pix", "ted"]`
 *   - `[{ rail: "pix" }, …]` / `[{ type: … }]` / `[{ id: … }]` / `[{ name: … }]`
 *   - `{ data: <either of the above> }`
 *
 * Returns null — never `[]` — when nothing is recognised. An empty array would read as
 * "the operator has disabled every rail", which is a real state this must not be
 * confused with: it would silently empty the rail picker rather than fall back.
 */
export function normalizeRails(payload: unknown): string[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const names = rows
    .map((row) => {
      if (typeof row === 'string') return row;
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      for (const key of ['rail', 'type', 'id', 'name'] as const) {
        if (typeof r[key] === 'string' && r[key]) return r[key] as string;
      }
      return null;
    })
    .filter((n): n is string => !!n);

  return names.length ? names : null;
}

/**
 * The rails to show, given what the server said.
 *
 * Intersects rather than replaces: the server decides WHICH rails are available, and
 * the local table still decides what fields each one needs and what it is called. That
 * split is what makes this safe to ship before the field schemas are known — a rail the
 * server offers but this build cannot render a form for is worse than one it does not
 * offer, because the user reaches a dead end instead of a shorter list.
 *
 * When the server is unreachable, unrecognised, or names no rail this build knows, the
 * full local table comes back. Failing open is right here specifically because the
 * failure is cosmetic: the operator's own KYC will refuse a rail they have disabled,
 * one step later, with a message that says so.
 */
export function availableRails(serverRails: string[] | null): typeof RAILS {
  if (!serverRails) return RAILS;
  const allowed = new Set(serverRails);
  const known = RAILS.filter((r) => allowed.has(r.type));
  return known.length ? known : RAILS;
}
