/**
 * The seller's bank transfer account (`src/lib/transferAccount.ts`): the response contract, how an
 * answer reads for the card, what a failed read or a refused activation means, and every rule of
 * the activation form — the CUIT/CUIL check digit, the kind of holder, phone, postal code, age.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '@/lib/apiError';
import { ApiShapeError, parseShape } from '@/lib/apiShape';
import { TransferAccountShape } from '@/lib/cosmospayShapes';
import { TRANSFER_NAME_MAX } from '@/constants/transferAccount';
import { T } from '@/lib/i18n';
import {
  birthDateProblem,
  cuitCheckOk,
  formatTaxId,
  normalizePhone,
  normalizePostalCode,
  oneLine,
  readTransferAccount,
  taxIdDigits,
  taxIdProblem,
  transferAccountBody,
  transferAccountProblems,
  transferAccountReadError,
  transferActivateFailure,
  transferFieldInput,
  transferProblemKey,
  transferVerificationUrlOk,
  type TransferAccountDraft,
  type TransferAccountField,
  type TransferAccountWire,
  type TransferFieldProblem,
} from '@/lib/transferAccount';

const NOW = Date.parse('2026-11-12T15:00:00.000Z');
const URL_ = 'https://api.cosmospay.lat/v1/onramp/transfer/account';

/** The contract's own example, at each status. */
const wire = (over: Record<string, unknown> = {}): TransferAccountWire =>
  ({
    status: 'none',
    type: null,
    name: null,
    verificationUrl: null,
    reason: null,
    alias: null,
    cvu: null,
    bank: null,
    updatedAt: null,
    ...over,
  }) as TransferAccountWire;

const person: TransferAccountDraft = {
  type: 'person',
  name: 'Juan Pérez',
  taxId: '20-12345678-6',
  email: 'juan@example.com',
  phone: '+5493875551234',
  address: 'Av. Belgrano 123',
  city: 'Salta',
  postalCode: '4400',
  dateOfBirth: '1990-01-15',
};

/** AFIP's own CUIT: a company's, with a valid check digit. */
const COMPANY_CUIT = '33-69345023-9';
const company: TransferAccountDraft = { ...person, type: 'company', name: 'Empanadas del Norte SRL', taxId: COMPANY_CUIT, dateOfBirth: '' };

const apiError = (status: number, code: string | null) => new ApiRequestError(URL_, status, code, 'refused');

/* ------------------------------- the contract ------------------------------- */

test('the response contract reads every status and refuses one it does not know', () => {
  for (const status of ['none', 'pending', 'in_review', 'approved', 'rejected']) {
    assert.doesNotThrow(() => parseShape('u', TransferAccountShape, wire({ status })), status);
  }
  assert.throws(() => parseShape('u', TransferAccountShape, wire({ status: 'suspended' })), ApiShapeError);
  assert.throws(() => parseShape('u', TransferAccountShape, wire({ status: undefined })), ApiShapeError);
});

test('the response contract asserts what the card opens and shows, and lets the rest through', () => {
  const approved = wire({ status: 'approved', type: 'person', name: 'Juan Pérez', alias: 'juan.perez.cp', cvu: '0000003100012345678901' });
  assert.doesNotThrow(() => parseShape('u', TransferAccountShape, approved));
  // Absent is read as null; a field added later passes untouched; an odd `type` is not the contract's business.
  assert.doesNotThrow(() => parseShape('u', TransferAccountShape, { status: 'none' }));
  assert.doesNotThrow(() => parseShape('u', TransferAccountShape, wire({ type: 'trust', limits: { daily: '1000000' } })));
  for (const broken of [{ alias: 123 }, { cvu: ['0000003100012345678901'] }, { verificationUrl: {} }]) {
    assert.throws(() => parseShape('u', TransferAccountShape, wire({ status: 'approved', ...broken })), ApiShapeError, JSON.stringify(broken));
  }
});

/* -------------------------------- the answer -------------------------------- */

test('an answer is read for the card: blanks are null, an unknown type is null', () => {
  const a = readTransferAccount(wire({ status: 'approved', type: 'company', name: '  Empanadas del Norte SRL ', alias: ' empanadas.norte ', cvu: '0000003100012345678901', bank: '' }));
  assert.deepEqual(a, {
    status: 'approved',
    type: 'company',
    name: 'Empanadas del Norte SRL',
    verificationUrl: null,
    reason: null,
    alias: 'empanadas.norte',
    cvu: '0000003100012345678901',
    bank: null,
    updatedAt: null,
  });
  assert.equal(readTransferAccount(wire({ type: 'trust' })).type, null);
  assert.equal(readTransferAccount(wire({ type: 7 })).type, null);
  assert.equal(readTransferAccount(wire({ status: 'rejected', reason: 'Document unreadable' })).reason, 'Document unreadable');
});

test('only an https verification page without credentials is ever opened', () => {
  assert.equal(transferVerificationUrlOk('https://verify.example.com/kyb/abc?token=x'), true);
  assert.equal(transferVerificationUrlOk('http://verify.example.com/kyb/abc'), false);
  assert.equal(transferVerificationUrlOk('https://user:pw@verify.example.com/kyb'), false);
  assert.equal(transferVerificationUrlOk('javascript:alert(1)'), false);
  assert.equal(transferVerificationUrlOk('not a url'), false);
  const pending = (verificationUrl: string) => readTransferAccount(wire({ status: 'pending', verificationUrl })).verificationUrl;
  assert.equal(pending(' https://verify.example.com/kyb/abc '), 'https://verify.example.com/kyb/abc');
  assert.equal(pending('http://verify.example.com/kyb/abc'), null);
  assert.equal(pending('file:///etc/passwd'), null);
});

test('a failed read: sign in for the shared key, no card where there are no bank transfers, retry otherwise', () => {
  assert.deepEqual(transferAccountReadError(apiError(403, 'account_required'), true), { kind: 'signin' });
  assert.deepEqual(transferAccountReadError(apiError(403, 'account_required'), false), { kind: 'signin' });
  for (const [status, code] of [[404, 'not_found'], [503, 'transfer_unavailable'], [401, null], [403, 'insufficient_scope'], [501, null]] as const) {
    assert.deepEqual(transferAccountReadError(apiError(status, code), false), { kind: 'off' }, `${status} ${code}`);
    assert.deepEqual(transferAccountReadError(apiError(status, code), true), { kind: 'off' }, `${status} ${code} shared`);
  }
  // A hiccup: an account may try again; the shared key's probe just stays quiet.
  assert.deepEqual(transferAccountReadError(apiError(500, 'internal_error'), false), { kind: 'failed' });
  assert.deepEqual(transferAccountReadError(new TypeError('Failed to fetch'), false), { kind: 'failed' });
  assert.deepEqual(transferAccountReadError(new ApiShapeError(URL_, 'status', 'one of: none', 'x'), false), { kind: 'failed' });
  assert.deepEqual(transferAccountReadError(apiError(500, 'internal_error'), true), { kind: 'off' });
});

test('a refused activation: the tax id, an account already under way, sign in, or a message', () => {
  assert.deepEqual(transferActivateFailure(apiError(400, 'invalid_tax_id')), { kind: 'taxId' });
  assert.deepEqual(transferActivateFailure(apiError(409, 'account_exists')), { kind: 'exists' });
  assert.deepEqual(transferActivateFailure(apiError(403, 'account_required')), { kind: 'signin' });
  assert.deepEqual(transferActivateFailure(apiError(503, 'transfer_unavailable')), { kind: 'message', key: 'transfer.unavailable' });
  assert.deepEqual(transferActivateFailure(apiError(429, 'rate_limited')), { kind: 'message', key: 'transfer.tooMany' });
  assert.deepEqual(transferActivateFailure(apiError(400, 'validation_failed')), { kind: 'message', key: 'transfer.invalid' });
  assert.deepEqual(transferActivateFailure(apiError(500, 'internal_error')), { kind: 'message', key: 'transfer.activateFailed' });
  assert.deepEqual(transferActivateFailure(new TypeError('Failed to fetch')), { kind: 'message', key: 'transfer.activateFailed' });
  // A 409 with another code is not "it exists".
  assert.deepEqual(transferActivateFailure(apiError(409, 'request_closed')), { kind: 'message', key: 'transfer.activateFailed' });
});

/* --------------------------------- CUIT/CUIL --------------------------------- */

test('the CUIT/CUIL check digit is modulo 11 over its weights', () => {
  assert.equal(cuitCheckOk('20123456786'), true);
  assert.equal(cuitCheckOk('33693450239'), true);
  for (let d = 0; d <= 9; d++) if (d !== 6) assert.equal(cuitCheckOk(`2012345678${d}`), false, `2012345678${d}`);
  // A body whose check digit would be 10 is never issued: no last digit makes it valid.
  for (let d = 0; d <= 9; d++) assert.equal(cuitCheckOk(`2012345676${d}`), false, `2012345676${d}`);
  assert.equal(cuitCheckOk('2012345678'), false);
  assert.equal(cuitCheckOk('201234567861'), false);
  assert.equal(cuitCheckOk('2012345678a'), false);
});

test('a tax id is read with or without separators, and written as on paper', () => {
  assert.equal(taxIdDigits('20-12345678-6'), '20123456786');
  assert.equal(taxIdDigits('20.12345678.6'), '20123456786');
  assert.equal(taxIdDigits(' 20 12345678 6 '), '20123456786');
  assert.equal(taxIdDigits('20/12345678/6'), null);
  assert.equal(taxIdDigits('CUIT 20123456786'), null);
  assert.equal(formatTaxId('20123456786'), '20-12345678-6');
});

test('a person gives a CUIL or CUIT of a person; a company, its CUIT', () => {
  assert.equal(taxIdProblem('20-12345678-6', 'person'), null);
  assert.equal(taxIdProblem(COMPANY_CUIT, 'company'), null);
  assert.equal(taxIdProblem('', 'person'), 'required');
  assert.equal(taxIdProblem('   ', 'company'), 'required');
  assert.equal(taxIdProblem('20-1234567', 'person'), 'format');
  assert.equal(taxIdProblem('12345678', 'person'), 'format');
  assert.equal(taxIdProblem('20-12345678-0', 'person'), 'check');
  assert.equal(taxIdProblem(COMPANY_CUIT, 'person'), 'kind');
  assert.equal(taxIdProblem('20-12345678-6', 'company'), 'kind');
  // A valid check digit with a prefix no holder has.
  assert.equal(cuitCheckOk('11123456787'), true);
  assert.equal(taxIdProblem('11-12345678-7', 'person'), 'kind');
  assert.equal(taxIdProblem('11-12345678-7', 'company'), 'kind');
});

/* ----------------------------------- the form ----------------------------------- */

test('a phone keeps its digits and an optional plus; a postal code is four digits or the CPA', () => {
  assert.equal(normalizePhone('+54 9 387 555-1234'), '+5493875551234');
  assert.equal(normalizePhone('(0387) 555.1234'), '03875551234');
  assert.equal(normalizePhone('5551234'), null);
  assert.equal(normalizePhone('+54 9 387 555 1234 5678 90'), null);
  assert.equal(normalizePhone('+54 387 abc'), null);
  assert.equal(normalizePostalCode('4400'), '4400');
  assert.equal(normalizePostalCode(' a4400xyz '), 'A4400XYZ');
  assert.equal(normalizePostalCode('A 4400 XYZ'), 'A4400XYZ');
  assert.equal(normalizePostalCode('440'), null);
  assert.equal(normalizePostalCode('AB4400'), null);
});

test('the holder of a person\'s account is of age, born on a real past date', () => {
  assert.equal(birthDateProblem('1990-01-15', NOW), null);
  assert.equal(birthDateProblem('2008-11-12', NOW), null);
  assert.equal(birthDateProblem('2008-11-13', NOW), 'age');
  assert.equal(birthDateProblem('2015-06-01', NOW), 'age');
  assert.equal(birthDateProblem('', NOW), 'required');
  assert.equal(birthDateProblem('15/01/1990', NOW), 'format');
  assert.equal(birthDateProblem('1990-02-30', NOW), 'format');
  assert.equal(birthDateProblem('1899-12-31', NOW), 'format');
  assert.equal(birthDateProblem('2027-01-01', NOW), 'format');
});

test('a complete form has no problems; a company needs no date of birth', () => {
  assert.deepEqual(transferAccountProblems(person, NOW), {});
  assert.deepEqual(transferAccountProblems(company, NOW), {});
  assert.deepEqual(transferAccountProblems({ ...company, type: 'person' }, NOW), { taxId: 'kind', dateOfBirth: 'required' });
});

test('every field says what is wrong with it', () => {
  const empty: TransferAccountDraft = { type: 'person', name: '', taxId: '', email: '', phone: '', address: '', city: '', postalCode: '', dateOfBirth: '' };
  // The phone, city and postal code are optional, as the API takes them; the rest is required.
  assert.deepEqual(transferAccountProblems(empty, NOW), {
    name: 'required',
    taxId: 'required',
    email: 'required',
    address: 'required',
    dateOfBirth: 'required',
  });
  assert.deepEqual(transferAccountProblems({ ...person, phone: '  ', city: '', postalCode: ' ' }, NOW), {});
  const bad = { ...person, name: 'J', email: 'juan@', phone: '123', address: 'Av', city: 'S', postalCode: '44', dateOfBirth: '2010-01-01' };
  assert.deepEqual(transferAccountProblems(bad, NOW), {
    name: 'format',
    email: 'format',
    phone: 'format',
    address: 'format',
    city: 'format',
    postalCode: 'format',
    dateOfBirth: 'age',
  });
});

test('the body sent is normalised, and there is none while a field has a problem', () => {
  const messy = {
    ...person,
    name: '  Juan \n Pérez ',
    taxId: '20.12345678.6',
    email: ' juan@example.com ',
    phone: '+54 9 387 555-1234',
    address: 'Av. Belgrano\t123',
    city: ' Salta ',
    postalCode: 'a4400xyz',
  };
  assert.deepEqual(transferAccountBody(messy, NOW), {
    type: 'person',
    name: 'Juan Pérez',
    taxId: '20-12345678-6',
    email: 'juan@example.com',
    phone: '+5493875551234',
    address: 'Av. Belgrano 123',
    city: 'Salta',
    postalCode: 'A4400XYZ',
    dateOfBirth: '1990-01-15',
  });
  const forCompany = transferAccountBody({ ...company, dateOfBirth: '1990-01-15' }, NOW);
  assert.equal(forCompany?.taxId, COMPANY_CUIT);
  assert.equal(forCompany && 'dateOfBirth' in forCompany, false);
  // Optional fields left empty are left out of the body, not sent blank.
  assert.deepEqual(transferAccountBody({ ...person, phone: '', city: '  ', postalCode: '' }, NOW), {
    type: 'person',
    name: 'Juan Pérez',
    taxId: '20-12345678-6',
    email: 'juan@example.com',
    address: 'Av. Belgrano 123',
    dateOfBirth: '1990-01-15',
  });
  assert.equal(transferAccountBody({ ...person, taxId: '20-12345678-0' }, NOW), null);
  assert.equal(transferAccountBody({ ...person, dateOfBirth: '' }, NOW), null);
});

test('a field keeps at most its cap of what was typed; a tax id only its digits and separators', () => {
  assert.equal(transferFieldInput('taxId', 'CUIT: 20-12345678-6'), ' 20-12345678-6'.slice(0, 13));
  assert.equal(transferFieldInput('taxId', '20-12345678-6'), '20-12345678-6');
  assert.equal(transferFieldInput('name', 'x'.repeat(500)).length, TRANSFER_NAME_MAX);
  assert.equal(transferFieldInput('postalCode', 'A4400XYZ123'), 'A4400XYZ');
  assert.equal(oneLine(' a\n\tb  c '), 'a b c');
});

test('every problem has a line in every language', () => {
  const cases: [TransferAccountField, TransferFieldProblem][] = [
    ['name', 'required'],
    ['name', 'format'],
    ['taxId', 'format'],
    ['taxId', 'check'],
    ['taxId', 'kind'],
    ['email', 'format'],
    ['phone', 'format'],
    ['address', 'format'],
    ['city', 'format'],
    ['postalCode', 'format'],
    ['dateOfBirth', 'format'],
    ['dateOfBirth', 'age'],
  ];
  for (const [field, problem] of cases) {
    for (const type of ['person', 'company'] as const) {
      const key = transferProblemKey(field, problem, type);
      assert.ok(T[key], `${field}/${problem}/${type} → ${key}`);
    }
  }
  assert.equal(transferProblemKey('taxId', 'kind', 'person'), 'transfer.errTaxIdCompany');
  assert.equal(transferProblemKey('taxId', 'kind', 'company'), 'transfer.errTaxIdPerson');
  for (const key of ['transfer.unavailable', 'transfer.tooMany', 'transfer.invalid', 'transfer.activateFailed','transfer.signIn', 'transfer.formIncomplete', 'transfer.errTaxIdServer']) {
    assert.ok(T[key], key);
  }
});
