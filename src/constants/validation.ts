/**
 * Shared validation rules (previously the only home for EMAIL_RE).
 *
 * All input rules now live in src/lib/validation.ts so screens and the store
 * import the SAME predicates (a disabled button is a hint, not an enforcement
 * point). This file remains as a backward-compatible re-export for any code
 * that still imports from '@/constants/validation'.
 */
export {
  EMAIL_RE,
  isValidAmount,
  isAmountWithin,
  isValidFiatAmount,
  hasAtMostSevenDecimals,
  sanitizeAmountInput,
  isWithinAmountDigitLimit,
  clampMemo,
  isValidMemo,
  isValidEmail,
  isValidName,
  isValidAssetCode,
  isValidPassword,
  hasMinLength,
  hasUppercase,
  hasDigit,
  hasLowercase,
  isValidEndpointUrl,
  isValidNetworkName,
  isValidNetworkPassphrase,
  isValidLinkCode,
  MEMO_MAX_LEN,
  ASSET_CODE_MAX_LEN,
  PWD_MIN_LEN,
  NAME_MIN_LEN,
  NAME_MAX_LEN,
  EMAIL_MAX_LEN,
} from '@/lib/validation';
