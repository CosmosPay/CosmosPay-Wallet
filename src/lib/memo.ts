/**
 * Stellar memo rules, in one place.
 *
 * Two bugs lived in the gap this file closes:
 *
 *  - SEP-7 links carry a `memo_type`. `parseStellarQr` read it, the store dropped
 *    it, and `sendPayment` always built `Memo.text`. A `MEMO_ID` payment request —
 *    which is how exchanges route a deposit to your account — silently became a
 *    text memo, so the deposit arrived unattributed.
 *
 *  - The 28 limit was applied with `.slice(0, 28)` in four places. Stellar's limit
 *    is 28 **bytes**, not characters: 28 'ñ' is 56 bytes, so the SDK threw *after*
 *    the user had already entered their password.
 *
 * Kept free of the Stellar SDK so it is testable on its own; `lib/stellar.ts` turns
 * a `MemoKind` into the SDK object.
 */
import { tNow } from '@/lib/i18n';

/** The memo kinds the wallet can attach to a payment it builds. */
export type MemoKind = 'text' | 'id';

/** Stellar text memos are capped at 28 BYTES of UTF-8. */
export const MEMO_TEXT_MAX_BYTES = 28;

/** Max uint64, the ceiling for MEMO_ID. */
const MEMO_ID_MAX = 18446744073709551615n;

const encoder = new TextEncoder();

export function memoByteLength(text: string): number {
  return encoder.encode(text ?? '').length;
}

/**
 * Trim `raw` to the byte limit without splitting a character. Iterating with
 * `for…of` walks code points, so a surrogate pair is never cut in half.
 */
export function clampMemoText(raw: string): string {
  const s = raw ?? '';
  if (memoByteLength(s) <= MEMO_TEXT_MAX_BYTES) return s;
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const n = encoder.encode(ch).length;
    if (bytes + n > MEMO_TEXT_MAX_BYTES) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** A MEMO_ID is a decimal uint64. */
export function isValidMemoId(raw: string): boolean {
  const v = (raw ?? '').trim();
  if (!/^\d+$/.test(v)) return false;
  try {
    return BigInt(v) <= MEMO_ID_MAX;
  } catch {
    return false;
  }
}

/** Map a SEP-7 `memo_type` to a kind we can attach. Unsupported types yield null. */
export function memoKindFromSep7(memoType?: string): MemoKind | null {
  const t = (memoType ?? '').toUpperCase();
  if (!t || t === 'MEMO_TEXT') return 'text';
  if (t === 'MEMO_ID') return 'id';
  return null; // MEMO_HASH / MEMO_RETURN: we do not build these
}

/**
 * Coerce a (kind, value) pair to something valid, or null when there is no memo to
 * attach. An id that is not a uint64 falls back to a text memo rather than being
 * dropped — losing the reference entirely is worse than sending it as text.
 */
export function normalizeMemo(value: string, kind: MemoKind = 'text'): { kind: MemoKind; value: string } | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (kind === 'id') {
    return isValidMemoId(v) ? { kind: 'id', value: v } : { kind: 'text', value: clampMemoText(v) };
  }
  return { kind: 'text', value: clampMemoText(v) };
}

/** Why a typed memo is not acceptable, for the UI. Null when it is fine (or empty). */
export function memoProblem(value: string, kind: MemoKind = 'text'): string | null {
  const v = value ?? '';
  if (!v.trim()) return null;
  if (kind === 'id') return isValidMemoId(v) ? null : tNow('memo.idMustBeInteger');
  const over = memoByteLength(v) - MEMO_TEXT_MAX_BYTES;
  return over > 0 ? tNow('memo.overByteLimit', { max: MEMO_TEXT_MAX_BYTES, over }) : null;
}
