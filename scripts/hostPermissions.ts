/**
 * Which Cosmos Pay hosts the MV3 manifest must name, derived from the build's own `.env`.
 *
 * A host permission is what makes Chrome and Firefox exempt an extension-page `fetch`
 * from CORS. That exemption is the only reason the popup can reach a backend whose
 * origin allowlist has never heard of `chrome-extension://<id>` — an id that differs per
 * unpacked install, so allowlisting it server-side was never an option.
 *
 * Which made a hardcoded list a trap. `.env.example` proposes production URLs outside
 * `*.cosmospay.lat`, and an extension built that way lost every backend call to CORS
 * with nothing in the manifest hinting why: the bundle knew the new host, the manifest
 * did not, and only one of the two was written by hand. Deriving both from the same two
 * variables removes the copy rather than guarding it.
 *
 * Its own module rather than a closure inside `build-extension.ts` because that script
 * writes files as a side effect of being imported, so a test could not reach the rule.
 * `tests/unit/hostPermissions.test.ts` is what keeps it honest.
 */

/** Hostname of a base URL, or '' for the same-origin default and anything unparseable. */
export function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** A base URL as an MV3 match pattern, or null when there is no host to match. */
export function hostPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.protocol}//${u.host}/*` : null;
  } catch {
    return null;
  }
}

/** The wallet's own domain, kept as a wildcard while a build still points at it. */
const COSMOSPAY_LAT = /(^|\.)cosmospay\.lat$/;

/**
 * Match patterns for the dev platform and the gateway this build was compiled against.
 *
 * The `*.cosmospay.lat` wildcards survive ONLY while one of the resolved hosts is still
 * on that domain. Sibling services live there too — the terms page in
 * `src/constants/app.ts`, anything the platform redirects to — so narrowing to the two
 * exact origins would silently drop them. Point the build elsewhere and they go, because
 * then they cover nothing this build calls, and an unused host permission is one more
 * line on the install prompt asking for access nobody uses.
 */
export function cosmosHostPermissions(bases: readonly string[]): string[] {
  const patterns = bases.map(hostPattern).filter((p): p is string => p !== null);
  const wildcards = bases.some((b) => COSMOSPAY_LAT.test(safeHost(b)))
    ? ['https://cosmospay.lat/*', 'https://*.cosmospay.lat/*']
    : [];
  return [...new Set([...patterns, ...wildcards])];
}
