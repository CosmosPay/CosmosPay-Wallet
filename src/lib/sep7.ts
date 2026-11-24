/**
 * SEP-0007 — Stellar URI scheme (`web+stellar:`).
 * We support the `pay` operation, which is what payment-request QRs encode:
 *   web+stellar:pay?destination=G…&amount=10&memo=hi&asset_code=USDC&asset_issuer=G…
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

import { Networks, StrKey } from '@stellar/stellar-sdk';

const SCHEME = 'web+stellar:';
/** Shape only — `isPublicKey` adds the CRC-16 checksum StrKey actually enforces. */
const PUBKEY_RE = /G[A-Z2-7]{55}/;

/** A well-formed, checksummed Stellar account id. */
function isPublicKey(v: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(v);
  } catch {
    return false;
  }
}

export interface Sep7Pay {
  destination: string;
  amount?: string;
  memo?: string;
  /** MEMO_TEXT | MEMO_ID | MEMO_HASH | MEMO_RETURN (defaults to text) */
  memoType?: string;
  assetCode?: string;
  assetIssuer?: string;
  msg?: string;
  /**
   * The passphrase of the network the request is for: the wallet's own. Written into the
   * link for every network but the public one, because SEP-7 reads a link WITHOUT
   * `network_passphrase` as a public-network request: a testnet QR that left it out had
   * another wallet build a mainnet payment from it.
   */
  networkPassphrase?: string;
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
  if (p.networkPassphrase && p.networkPassphrase !== Networks.PUBLIC) params.set('network_passphrase', p.networkPassphrase);
  // Spaces as `%20`, not the form encoding's `+`: a wallet that reads the link with
  // `decodeURIComponent` would otherwise compare `Test+SDF+Network+;+September+2015` against
  // the passphrase. A literal `+` is already `%2B`, so this changes nothing else.
  return `${SCHEME}pay?${params.toString().replace(/\+/g, '%20')}`;
}

export interface ParsedQr {
  destination: string;
  amount?: string;
  memo?: string;
  memoType?: string;
  assetCode?: string;
  assetIssuer?: string;
  /** The link's `network_passphrase`, when it names one. */
  networkPassphrase?: string;
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
      if (isPublicKey(destination)) {
        const memoTypeRaw = (params.get('memo_type') || '').toUpperCase();
        // Only surface a memo we can actually attach (plain text / id).
        const memoUsable = memoTypeRaw === '' || memoTypeRaw === 'MEMO_TEXT' || memoTypeRaw === 'MEMO_ID';
        const assetIssuer = (params.get('asset_issuer') || '').trim();
        return {
          destination,
          amount: params.get('amount') || undefined,
          memo: memoUsable ? params.get('memo') || undefined : undefined,
          memoType: memoTypeRaw || undefined,
          assetCode: params.get('asset_code') || undefined,
          // An asset code without a valid issuer is not an asset — dropping the pair
          // together stops a half-parsed link from resolving to the wrong token.
          assetIssuer: isPublicKey(assetIssuer) ? assetIssuer : undefined,
          networkPassphrase: params.get('network_passphrase') || undefined,
        };
      }
    }
    // A malformed `pay` (or a `tx` op) is NOT scanned for a loose address: the query
    // string holds attacker-supplied fields like `msg`, and the old fall-through
    // happily picked an address out of one of them — so `?destination=<invalid>
    // &msg=G<attacker>` resolved to the attacker. A broken link is simply rejected.
    return null;
  }

  // Bare `stellar:G…` / plain `G…`. Every candidate is checksum-validated, so a
  // near-miss address is rejected rather than silently accepted.
  for (const m of text.matchAll(new RegExp(PUBKEY_RE, 'g'))) {
    if (isPublicKey(m[0])) return { destination: m[0] };
  }
  return null;
}

/**
 * Whether a request names a network other than the wallet's (`passphrase`, from its own
 * `NetConfig`). Paying it anyway would send real money for a test request, or the reverse,
 * so every way a request reaches the wallet refuses it: the scanner, a paste into Send, a
 * link in the URL (`store.applySep7`) and a site's `requestPayment` (ApprovePopup).
 *
 * Only a passphrase the link NAMES is compared. SEP-7 reads a missing one as the public
 * network, but most wallets leave it out of their testnet QRs too (this one did, before
 * `buildSep7Pay` wrote it), and refusing all of those on a test network would refuse test
 * money only.
 */
export function isForOtherNetwork(req: Pick<ParsedQr, 'networkPassphrase'>, passphrase: string): boolean {
  return !!req.networkPassphrase && req.networkPassphrase !== passphrase;
}

/** What a payment request came to on its way into the send draft. */
export type Sep7Outcome = 'applied' | 'invalid' | 'otherNetwork';

/** A scanned or pasted payment request read against the wallet's network: the request, or why not. */
export type PaymentRequestRead = { ok: true; request: ParsedQr } | { ok: false; reason: Exclude<Sep7Outcome, 'applied'> };

export function readPaymentRequest(raw: string, passphrase: string): PaymentRequestRead {
  const request = parseStellarQr(raw);
  if (!request) return { ok: false, reason: 'invalid' };
  if (isForOtherNetwork(request, passphrase)) return { ok: false, reason: 'otherNetwork' };
  return { ok: true, request };
}
