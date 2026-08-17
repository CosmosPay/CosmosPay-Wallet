import test from 'node:test';
import assert from 'node:assert';
import {
  contractRegisterResult,
  contractSwapQuote,
  assertObject,
  assertString
} from '../src/lib/contracts';
import { extractUnsignedXdr } from '../src/lib/cosmospay';

test('assertObject should throw if not an object', () => {
  assert.throws(() => assertObject(null, 'Test'), /expected Test to be an object/);
  assert.throws(() => assertObject('string', 'Test'), /expected Test to be an object/);
  assert.throws(() => assertObject([], 'Test'), /expected Test to be an object/);
  assert.ok(assertObject({}, 'Test'));
});

test('assertString should throw if not a string', () => {
  assert.throws(() => assertString(123, 'field'), /missing or invalid string field/);
  assert.throws(() => assertString(null, 'field'), /missing or invalid string field/);
  assert.strictEqual(assertString('valid', 'field'), 'valid');
});

test('contractRegisterResult parses valid pending result and ignores extra fields', () => {
  const valid = {
    status: 'pending',
    claimToken: 'token_123',
    expiresInSeconds: 3600,
    extraField: 'should pass through',
    nestedExtra: {
        foo: 'bar'
    }
  };

  const result = contractRegisterResult(valid);
  assert.strictEqual(result.status, 'pending');
  // @ts-ignore
  assert.strictEqual(result.extraField, 'should pass through');
});

test('contractRegisterResult throws if missing acted-on field', () => {
  const invalid = {
    status: 'pending',
    // missing claimToken
    expiresInSeconds: 3600
  };

  assert.throws(() => contractRegisterResult(invalid), /missing or invalid string field 'claimToken'/);
});

test('extractUnsignedXdr extracts XDR from nested structures', () => {
  // A string > 40 chars
  const validXdr = 'AAAAAgAAAABv...this_is_a_mock_base64_string_that_is_long_enough...';
  
  const payload1 = { transaction_hash: validXdr };
  assert.strictEqual(extractUnsignedXdr(payload1), validXdr);

  const payload2 = { data: { payout: { unsigned_tx: validXdr } } };
  assert.strictEqual(extractUnsignedXdr(payload2), validXdr);
});

test('extractUnsignedXdr throws if no XDR found', () => {
  const payload = { data: { payout: { unknown_field: 'short' } } };
  assert.throws(() => extractUnsignedXdr(payload), /unsigned XDR field not found/);
});
