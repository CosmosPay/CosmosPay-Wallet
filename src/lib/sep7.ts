/**
 * SEP-0007 — Stellar URI scheme (`web+stellar:`).
 * We support the `pay` operation, which is what payment-request QRs encode:
 *   web+stellar:pay?destination=G…&amount=10&memo=hi&asset_code=USDC&asset_issuer=G…
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

const SCHEME = 'web+stellar:';
const PUBKEY_RE = /G[A-Z2-7]{55}/;

export interface Sep7Pay {
  destination: string;
  amount?: string;
  memo?: string;
  /** MEMO_TEXT | MEMO_ID | MEMO_HASH | MEMO_RETURN (defaults to text) */
  memoType?: string;
  assetCode?: string;
  assetIssuer?: string;
  msg?: string;
}

/** Build a `web+stellar:pay` URI from a payment request. Empty fields are omitted. */
export function buildSep7Pay(p: Sep7Pay): string {
  const params = new URLSearchParams();
  params.set('destination', p.destination);
  if (p.amount && Number(p.amount) > 0) params.set('amount', p.amount);
  if (p.assetCode) params.set('asset_code', p.assetCode);
  if (p.assetIssuer) params.set('asset_issuer', p.assetIssuer);
  if (p.memo) {
    params.set('memo', p.memo);
    params.set('memo_type', p.memoType || 'MEMO_TEXT');
  }
  if (p.msg) params.set('msg', p.msg);
  return `${SCHEME}pay?${params.toString()}`;
}

export interface ParsedQr {
  destination: string;
  amount?: string;
  memo?: string;
  memoType?: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Parse the payload of a scanned QR. Accepts:
 *  - a SEP-7 `web+stellar:pay?…` URI (destination + optional amount/memo/asset)
 *  - a bare `stellar:G…` or plain `G…` address (with optional `?amount=` suffix)
 * Returns null when no valid Stellar destination can be found.
 */
export function parseStellarQr(raw: string): ParsedQr | null {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (lower.startsWith(SCHEME)) {
    const rest = text.slice(SCHEME.length);
    const qIdx = rest.indexOf('?');
    const op = (qIdx === -1 ? rest : rest.slice(0, qIdx)).toLowerCase();
    const params = new URLSearchParams(qIdx === -1 ? '' : rest.slice(qIdx + 1));
    if (op === 'pay') {
      const destination = (params.get('destination') || '').trim();
      if (PUBKEY_RE.test(destination)) {
        const memoTypeRaw = (params.get('memo_type') || '').toUpperCase();
        // Only surface a memo we can actually attach (plain text / id).
        const memoUsable = memoTypeRaw === '' || memoTypeRaw === 'MEMO_TEXT' || memoTypeRaw === 'MEMO_ID';
        return {
          destination,
          amount: params.get('amount') || undefined,
          memo: memoUsable ? params.get('memo') || undefined : undefined,
          memoType: memoTypeRaw || undefined,
          assetCode: params.get('asset_code') || undefined,
          assetIssuer: params.get('asset_issuer') || undefined,
        };
      }
    }
    // tx op or malformed pay — fall through to a raw address scan below.
  }

  const m = text.match(PUBKEY_RE);
  return m ? { destination: m[0] } : null;
}
