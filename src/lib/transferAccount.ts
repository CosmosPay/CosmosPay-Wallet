/**
 * The seller's bank transfer account: the wallet's side of `/v1/onramp/transfer/account` (calls in
 * `src/lib/cosmospay.ts`, calls with the right key in `src/state/useTransferAccount.ts`, card in
 * `src/features/fiat/TransferAccountCard.tsx`). A seller signed in with a Cosmos Pay account
 * activates it once with their details; the API opens a receiving account in their own name,
 * the person verifies on a hosted page, and once approved their QR charges can also be paid by
 * bank transfer to their own alias and CVU. The shared public key has no account to activate.
 *
 * Everything here is pure, so `tests/unit/transferAccount.test.ts` pins it: how an answer reads,
 * what a failed read means for the card, and every rule of the activation form — the CUIT/CUIL
 * check digit above all, because the API refuses a wrong one only after a round trip.
 */
import {
  CUIT_COMPANY_PREFIXES,
  CUIT_PERSON_PREFIXES,
  CUIT_WEIGHTS,
  TRANSFER_ACCOUNT_TYPES,
  TRANSFER_ADDRESS_MAX,
  TRANSFER_ADDRESS_MIN,
  TRANSFER_BIRTH_YEAR_MIN,
  TRANSFER_CITY_MAX,
  TRANSFER_CITY_MIN,
  TRANSFER_DATE_INPUT_MAX,
  TRANSFER_EMAIL_MAX,
  TRANSFER_MIN_AGE,
  TRANSFER_NAME_MAX,
  TRANSFER_NAME_MIN,
  TRANSFER_PHONE_INPUT_MAX,
  TRANSFER_PHONE_MAX_DIGITS,
  TRANSFER_PHONE_MIN_DIGITS,
  TRANSFER_POSTAL_CODE_MAX,
  TRANSFER_TAX_ID_INPUT_MAX,
  type TransferAccountStatus,
  type TransferAccountType,
} from '@/constants/transferAccount';
import { ApiRequestError } from '@/lib/apiError';
import { isEmail, isHttpsUrl } from '@/lib/validate';

/* ------------------------------- the answer ------------------------------- */

/**
 * The account as the API answers it, checked by `TransferAccountShape` (`status`, and the
 * fields the card opens or shows: `verificationUrl`, `alias`, `cvu`); the rest arrives
 * unchecked and is read by `readTransferAccount`.
 */
export interface TransferAccountWire {
  status: TransferAccountStatus;
  verificationUrl: string | null;
  alias: string | null;
  cvu: string | null;
  type?: unknown;
  name?: unknown;
  reason?: unknown;
  bank?: unknown;
  updatedAt?: unknown;
}

/** The account as the card shows it. */
export interface TransferAccount {
  status: TransferAccountStatus;
  type: TransferAccountType | null;
  /** The holder's name, as the payer sees it on the transfer. */
  name: string | null;
  /** The hosted verification form, while `pending` or `in_review`; only ever an https page. */
  verificationUrl: string | null;
  /** Why it was rejected, in the verifier's words. */
  reason: string | null;
  /** Once `approved`, where the payer transfers to; both arrive a little after the approval. */
  alias: string | null;
  cvu: string | null;
  bank: string | null;
  updatedAt: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const isType = (v: unknown): v is TransferAccountType =>
  typeof v === 'string' && (TRANSFER_ACCOUNT_TYPES as readonly string[]).includes(v);

/**
 * Where "Finish your verification" may send the person: an https page with no credentials in
 * it. The host is the verifier's and is not pinned. Anything else is never opened.
 */
export function transferVerificationUrlOk(url: string): boolean {
  if (!isHttpsUrl(url)) return false;
  const u = new URL(url);
  return !u.username && !u.password;
}

/** An answer read for the card: blanks are null, a type it does not know is null, a page it may not open is dropped. */
export function readTransferAccount(wire: TransferAccountWire): TransferAccount {
  const url = text(wire.verificationUrl);
  return {
    status: wire.status,
    type: isType(wire.type) ? wire.type : null,
    name: text(wire.name),
    verificationUrl: url && transferVerificationUrlOk(url) ? url : null,
    reason: text(wire.reason),
    alias: text(wire.alias),
    cvu: text(wire.cvu),
    bank: text(wire.bank),
    updatedAt: text(wire.updatedAt),
  };
}

/** What the card shows after asking for the account. */
export type TransferAccountRead =
  | { kind: 'account'; account: TransferAccount }
  /** The shared public key: bank transfers need a signed-in account (the API said `account_required`). */
  | { kind: 'signin' }
  /** This deployment does not offer bank transfers (no such route, or switched off). The card is not shown. */
  | { kind: 'off' }
  /** It could not be read this time: the card offers to try again. */
  | { kind: 'failed' };

/**
 * What a failed read means. `403 account_required` is the API telling the shared public key that
 * only accounts have one — the feature exists, so the seller is asked to sign in. A missing route
 * (404), a deployment without the rail (503) or a key refused for another reason is "off": no
 * card. Anything else failed this time, and an account may try again; the shared key's probe is
 * never worth a retry button.
 */
export function transferAccountReadError(e: unknown, shared: boolean): TransferAccountRead {
  if (e instanceof ApiRequestError) {
    if (e.status === 403 && e.code === 'account_required') return { kind: 'signin' };
    if (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 501 || e.status === 503) return { kind: 'off' };
  }
  return shared ? { kind: 'off' } : { kind: 'failed' };
}

/* -------------------------------- the form -------------------------------- */

/** What the activation form holds, as typed. */
export interface TransferAccountDraft {
  type: TransferAccountType;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  /** `YYYY-MM-DD`, persons only. */
  dateOfBirth: string;
}

export type TransferAccountField = Exclude<keyof TransferAccountDraft, 'type'>;

/**
 * Why a field cannot be sent: empty, malformed, a CUIT/CUIL whose check digit is wrong, a tax id
 * of the other kind (a company's for a person or the other way round), or a holder under age.
 */
export type TransferFieldProblem = 'required' | 'format' | 'check' | 'kind' | 'age';

/** What `POST /v1/onramp/transfer/account` takes (`CreateTransferAccountDto`): the phone, city and postal code are optional there. */
export interface TransferAccountInput {
  type: TransferAccountType;
  name: string;
  /** `XX-XXXXXXXX-X`. */
  taxId: string;
  email: string;
  phone?: string;
  address: string;
  city?: string;
  postalCode?: string;
  /** Persons only. */
  dateOfBirth?: string;
}

/** Control characters and line breaks become spaces, runs of spaces one, and the ends are trimmed. */
export function oneLine(raw: string): string {
  return raw.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** The digits of a CUIT/CUIL as typed with or without `-`, `.` or spaces; null when anything else is in it. */
export function taxIdDigits(raw: string): string | null {
  const digits = raw.replace(/[\s.-]/g, '');
  return /^\d+$/.test(digits) ? digits : null;
}

/** Whether eleven digits carry a valid CUIT/CUIL check digit (modulo 11 over `CUIT_WEIGHTS`; a remainder that gives 10 is never issued). */
export function cuitCheckOk(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const sum = CUIT_WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const rest = 11 - (sum % 11);
  const check = rest === 11 ? 0 : rest;
  return check !== 10 && check === Number(digits[10]);
}

/** A CUIT/CUIL as written on paper: `20-12345678-6`. */
export function formatTaxId(digits: string): string {
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/**
 * Why a CUIT/CUIL cannot be sent for this kind of holder: eleven digits, a valid check digit, and
 * the prefix of the kind — a person's (20, 23, 24, 25, 26, 27) or a company's CUIT (30, 33, 34).
 */
export function taxIdProblem(raw: string, type: TransferAccountType): TransferFieldProblem | null {
  if (!raw.trim()) return 'required';
  const digits = taxIdDigits(raw);
  if (!digits || digits.length !== 11) return 'format';
  if (!cuitCheckOk(digits)) return 'check';
  const prefixes: readonly string[] = type === 'company' ? CUIT_COMPANY_PREFIXES : CUIT_PERSON_PREFIXES;
  return prefixes.includes(digits.slice(0, 2)) ? null : 'kind';
}

/** A phone number as sent: spaces, dashes, dots and parentheses dropped; an optional `+` and 8 to 15 digits, or null. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, '');
  const re = new RegExp(`^\\+?\\d{${TRANSFER_PHONE_MIN_DIGITS},${TRANSFER_PHONE_MAX_DIGITS}}$`);
  return re.test(s) ? s : null;
}

/** An Argentine postal code as sent: four digits, or the CPA (`A4400XYZ`); upper case, no spaces; null otherwise. */
export function normalizePostalCode(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]?\d{4}[A-Z]{0,3}$/.test(s) ? s : null;
}

/** Why a date of birth (`YYYY-MM-DD`) cannot be sent at `now`: not a real past date, or under age. */
export function birthDateProblem(raw: string, now: number): TransferFieldProblem | null {
  const s = raw.trim();
  if (!s) return 'required';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return 'format';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 'format';
  if (y < TRANSFER_BIRTH_YEAR_MIN || date.getTime() > now) return 'format';
  const today = new Date(now);
  const [ty, tm, td] = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()];
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  return age < TRANSFER_MIN_AGE ? 'age' : null;
}

function lengthProblem(raw: string, min: number, max: number): TransferFieldProblem | null {
  const s = oneLine(raw);
  if (!s) return 'required';
  return s.length < min || s.length > max ? 'format' : null;
}

/** An optional field says nothing while empty; once typed, it is held to its rule. */
const optional = (raw: string, problem: () => TransferFieldProblem | null): TransferFieldProblem | null => (raw.trim() ? problem() : null);

/** The most a field keeps of a keystroke or a paste: the text fields their length, a tax id its digits and separators. */
const FIELD_CAP: Record<TransferAccountField, number> = {
  name: TRANSFER_NAME_MAX,
  taxId: TRANSFER_TAX_ID_INPUT_MAX,
  email: TRANSFER_EMAIL_MAX,
  phone: TRANSFER_PHONE_INPUT_MAX,
  address: TRANSFER_ADDRESS_MAX,
  city: TRANSFER_CITY_MAX,
  postalCode: TRANSFER_POSTAL_CODE_MAX,
  dateOfBirth: TRANSFER_DATE_INPUT_MAX,
};

/** What a field keeps of what was typed: at most its cap, and for the tax id only digits, `-`, `.` and spaces. */
export function transferFieldInput(field: TransferAccountField, raw: string): string {
  const s = field === 'taxId' ? raw.replace(/[^\d\s.-]/g, '') : raw;
  return [...s].slice(0, FIELD_CAP[field]).join('');
}

/**
 * Every field that cannot be sent, and why; empty when the form can go. The phone, city and postal
 * code are optional (the API's own rule) but checked once typed; the date of birth counts for
 * persons only.
 */
export function transferAccountProblems(draft: TransferAccountDraft, now: number): Partial<Record<TransferAccountField, TransferFieldProblem>> {
  const out: Partial<Record<TransferAccountField, TransferFieldProblem>> = {};
  const put = (field: TransferAccountField, problem: TransferFieldProblem | null) => {
    if (problem) out[field] = problem;
  };
  put('name', lengthProblem(draft.name, TRANSFER_NAME_MIN, TRANSFER_NAME_MAX));
  put('taxId', taxIdProblem(draft.taxId, draft.type));
  put('email', !draft.email.trim() ? 'required' : isEmail(draft.email.trim()) ? null : 'format');
  put('phone', optional(draft.phone, () => (normalizePhone(draft.phone) ? null : 'format')));
  put('address', lengthProblem(draft.address, TRANSFER_ADDRESS_MIN, TRANSFER_ADDRESS_MAX));
  put('city', optional(draft.city, () => lengthProblem(draft.city, TRANSFER_CITY_MIN, TRANSFER_CITY_MAX)));
  put('postalCode', optional(draft.postalCode, () => (normalizePostalCode(draft.postalCode) ? null : 'format')));
  if (draft.type === 'person') put('dateOfBirth', birthDateProblem(draft.dateOfBirth, now));
  return out;
}

/** The body to send, normalised and without the optional fields left empty, or null while any field has a problem (`transferAccountProblems`). */
export function transferAccountBody(draft: TransferAccountDraft, now: number): TransferAccountInput | null {
  if (Object.keys(transferAccountProblems(draft, now)).length > 0) return null;
  const digits = taxIdDigits(draft.taxId) ?? '';
  const body: TransferAccountInput = {
    type: draft.type,
    name: oneLine(draft.name),
    taxId: formatTaxId(digits),
    email: draft.email.trim(),
    address: oneLine(draft.address),
  };
  const phone = normalizePhone(draft.phone);
  const city = oneLine(draft.city);
  const postalCode = normalizePostalCode(draft.postalCode);
  if (phone) body.phone = phone;
  if (city) body.city = city;
  if (postalCode) body.postalCode = postalCode;
  if (draft.type === 'person') body.dateOfBirth = draft.dateOfBirth.trim();
  return body;
}

/** What an activation the API refused means for the form. */
export type TransferActivateFailure =
  /** The API checked the CUIT/CUIL and refused it (`400 invalid_tax_id`). */
  | { kind: 'taxId' }
  /** An account is already under way (`409 account_exists`): read it instead. */
  | { kind: 'exists' }
  /** Only an account may activate one (`403 account_required`). */
  | { kind: 'signin' }
  /** Anything else, said with this i18n key. */
  | { kind: 'message'; key: string };

/** Map a refused activation to what the form does about it; branches on the API's codes, never on its words. */
export function transferActivateFailure(e: unknown): TransferActivateFailure {
  if (e instanceof ApiRequestError) {
    if (e.code === 'invalid_tax_id') return { kind: 'taxId' };
    if (e.status === 409 && e.code === 'account_exists') return { kind: 'exists' };
    if (e.status === 403 && e.code === 'account_required') return { kind: 'signin' };
    if (e.status === 503 || e.code === 'transfer_unavailable') return { kind: 'message', key: 'transfer.unavailable' };
    if (e.status === 429) return { kind: 'message', key: 'transfer.tooMany' };
    if (e.status === 400 && e.code === 'validation_failed') return { kind: 'message', key: 'transfer.invalid' };
  }
  return { kind: 'message', key: 'transfer.activateFailed' };
}

/** The i18n key of the line under a field with a problem. */
export function transferProblemKey(field: TransferAccountField, problem: TransferFieldProblem, type: TransferAccountType): string {
  if (problem === 'required') return 'transfer.errRequired';
  switch (field) {
    case 'taxId':
      if (problem === 'check') return 'transfer.errTaxIdCheck';
      if (problem === 'kind') return type === 'person' ? 'transfer.errTaxIdCompany' : 'transfer.errTaxIdPerson';
      return 'transfer.errTaxIdFormat';
    case 'email':
      return 'transfer.errEmail';
    case 'phone':
      return 'transfer.errPhone';
    case 'postalCode':
      return 'transfer.errPostalCode';
    case 'dateOfBirth':
      return problem === 'age' ? 'transfer.errAge' : 'transfer.errBirth';
    default:
      return 'transfer.errTooShort';
  }
}
