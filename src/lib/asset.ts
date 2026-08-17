/**
 * Asset identity.
 *
 * On Stellar an asset is a (code, issuer) pair — the code alone is not an
 * identifier. Anyone can issue a token called "USDC"; that is the standard scam on
 * this network. The wallet used to carry assets around as a bare code string:
 * `AssetSelect` rendered one row per trustline but reported only `a.code`, and
 * `submitSend` then resolved it with `balances.find(b => b.code === code)` — so with
 * two "USDC" trustlines the *order Horizon returned them in* decided which issuer
 * the user paid.
 *
 * Everything that selects, stores or submits an asset now passes an `AssetRef`.
 */

export interface AssetRef {
  code: string;
  /** null for the native asset. */
  issuer: string | null;
}

export const XLM: AssetRef = { code: 'XLM', issuer: null };

/** Stable identity: "XLM" for native, "CODE:ISSUER" otherwise. */
export function assetKey(a: AssetRef | null | undefined): string {
  if (!a) return '';
  return a.issuer ? `${a.code}:${a.issuer}` : a.code;
}

export function isSameAsset(a: AssetRef | null | undefined, b: AssetRef | null | undefined): boolean {
  return assetKey(a) === assetKey(b) && !!a && !!b;
}

export function isNativeRef(a: AssetRef | null | undefined): boolean {
  return !!a && !a.issuer && a.code === 'XLM';
}

/** Find the held balance matching `ref` exactly — issuer included. */
export function findAsset<T extends AssetRef>(list: readonly T[], ref: AssetRef | null | undefined): T | undefined {
  if (!ref) return undefined;
  const key = assetKey(ref);
  return list.find((a) => assetKey(a) === key);
}

/**
 * True when the account holds more than one asset under this code — i.e. the code
 * on its own is not enough for the user to tell them apart, so the UI must show
 * the issuer.
 */
export function codeIsAmbiguous(list: readonly AssetRef[], code: string): boolean {
  let seen = 0;
  for (const a of list) {
    if (a.code === code && ++seen > 1) return true;
  }
  return false;
}

/** "GA1BX…K4KZVN" — enough to compare two issuers at a glance. */
export function shortIssuer(issuer: string | null | undefined, n = 4): string {
  if (!issuer) return '';
  return issuer.length > n * 2 + 1 ? `${issuer.slice(0, n)}…${issuer.slice(-n)}` : issuer;
}

/** Convert to the shape `sendPayment` takes (null = native). */
export function toPaymentAsset(a: AssetRef | null | undefined): { code: string; issuer: string } | null {
  if (!a || !a.issuer || a.code === 'XLM') return null;
  return { code: a.code, issuer: a.issuer };
}
