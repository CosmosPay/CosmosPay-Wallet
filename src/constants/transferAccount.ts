/**
 * The seller's bank transfer account (`/v1/onramp/transfer/account`; rules in
 * `src/lib/transferAccount.ts`, card in `src/features/fiat/TransferAccountCard.tsx`). A seller
 * who signs in with a Cosmos Pay account activates it once: the API opens a receiving account in
 * their own name (their own verification, alias and CVU), and from then on their QR charges can
 * also be paid by bank transfer. No provider is ever named in the wallet's copy.
 */

/**
 * What the API says of the account: `none` until activated, `pending` until the person finishes
 * the hosted verification form, `in_review` while it is checked, then `approved` or `rejected`.
 */
export const TRANSFER_ACCOUNT_STATUSES = ['none', 'pending', 'in_review', 'approved', 'rejected'] as const;
export type TransferAccountStatus = (typeof TRANSFER_ACCOUNT_STATUSES)[number];

/** Who the account is for: a person (CUIL or CUIT, with a date of birth) or a company (CUIT only). */
export const TRANSFER_ACCOUNT_TYPES = ['person', 'company'] as const;
export type TransferAccountType = (typeof TRANSFER_ACCOUNT_TYPES)[number];

/** CUIT/CUIL check digit: the weights of its first ten digits, modulo 11. */
export const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** The first two digits of a person's CUIL or CUIT. */
export const CUIT_PERSON_PREFIXES = ['20', '23', '24', '25', '26', '27'] as const;

/** The first two digits of a company's CUIT. */
export const CUIT_COMPANY_PREFIXES = ['30', '33', '34'] as const;

/** Field lengths, in characters once trimmed. */
export const TRANSFER_NAME_MIN = 2;
export const TRANSFER_NAME_MAX = 120;
export const TRANSFER_ADDRESS_MIN = 3;
export const TRANSFER_ADDRESS_MAX = 140;
export const TRANSFER_CITY_MIN = 2;
export const TRANSFER_CITY_MAX = 80;

/** What the other fields keep of a paste: a CUIT/CUIL with its separators (`20-12345678-6` is 13), an email, a phone as typed, a CPA postal code (`A4400XYZ`), a `YYYY-MM-DD` date. */
export const TRANSFER_TAX_ID_INPUT_MAX = 13;
export const TRANSFER_EMAIL_MAX = 254;
export const TRANSFER_PHONE_INPUT_MAX = 24;
export const TRANSFER_POSTAL_CODE_MAX = 8;
export const TRANSFER_DATE_INPUT_MAX = 10;

/** A phone number's digits, country code included (E.164 allows 15). */
export const TRANSFER_PHONE_MIN_DIGITS = 8;
export const TRANSFER_PHONE_MAX_DIGITS = 15;

/** The account holder must be of age; and nobody was born before this year. */
export const TRANSFER_MIN_AGE = 18;
export const TRANSFER_BIRTH_YEAR_MIN = 1900;
