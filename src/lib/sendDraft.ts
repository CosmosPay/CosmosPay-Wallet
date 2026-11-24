/**
 * The Stellar send draft (`store.send`, which Send fills and Confirm reads), and the rules for
 * what writes it.
 *
 * Kept out of the store hook so it can be tested: a payment request used to be MERGED into the
 * draft, field by field, keeping whatever the request did not name. A SEP-7 link abandoned with
 * an amount of 2 and a memo, then a scanned QR of a plain address, opened Send on the new
 * address with the old amount and the old memo, one tap from review.
 */
import { XLM, type AssetRef } from '@/lib/asset';
import { sameNetworkAddress } from '@/lib/crossChainDest';
import { clampMemoText, memoKindFromSep7, type MemoKind } from '@/lib/memo';
import type { ParsedQr } from '@/lib/sep7';
import type { NetworkId } from '@/constants/networks';

export interface SendDraft {
  to: string;
  amount: string;
  memo: string;
  /** 'text' (default) or 'id': a SEP-7 MEMO_ID must survive to the built tx. */
  memoKind: MemoKind;
  /** Full (code, issuer) identity. A bare code is ambiguous, see lib/asset.ts. */
  asset: AssetRef;
}

/** A draft with nothing in it: XLM, no recipient, no amount, no memo. */
export function emptySendDraft(): SendDraft {
  return { to: '', amount: '0', memo: '', memoKind: 'text', asset: XLM };
}

/**
 * The draft a scanned or pasted request starts: EVERY field from the request, or its empty
 * value where the request names none. Never a merge with the draft before it, whose amount,
 * memo and asset belong to another payment.
 *
 * The memo's TYPE travels with it (a MEMO_ID request, how an exchange routes a deposit, used to
 * arrive as text and land unattributed), clamped by bytes. The link's asset only as a pair: a
 * code without its issuer is no asset, and the request then means XLM.
 */
export function draftFromRequest(req: ParsedQr): SendDraft {
  const memo = req.memo ? clampMemoText(req.memo) : '';
  return {
    to: req.destination,
    amount: req.amount ?? '0',
    memo,
    memoKind: memo ? (memoKindFromSep7(req.memoType) ?? 'text') : 'text',
    asset: req.assetCode && req.assetIssuer ? { code: req.assetCode, issuer: req.assetIssuer } : XLM,
  };
}

/**
 * Whether `to` is the wallet's own address (`own`) on `network`, compared as that network spells
 * addresses (`sameNetworkAddress`: an EVM address in any case, a Stellar one exactly).
 */
export function sendsToSelf(network: NetworkId, to: string, own: string | null | undefined): boolean {
  return !!own && !!to.trim() && sameNetworkAddress(network, to, own);
}
