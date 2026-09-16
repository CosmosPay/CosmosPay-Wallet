/**
 * The bridge refuses a login another account completed, and the wallet shows that refusal
 * by its machine code — never by matching the English sentence beside it. See
 * `identityRefusalKey` in src/lib/pollar.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '@/lib/apiError';
import { identityRefusalKey } from '@/lib/pollar';

const URL_ = 'https://gw.example/v1/pollar/oauth/token';

test('names the two identity refusals by key', () => {
  assert.equal(
    identityRefusalKey(new ApiRequestError(URL_, 403, 'pollar_identity_mismatch', 'English copy')),
    'pollar.identityMismatch',
  );
  assert.equal(
    identityRefusalKey(new ApiRequestError(URL_, 403, 'pollar_identity_required', 'English copy')),
    'pollar.identityRequired',
  );
});

test('leaves every other failure to its own message', () => {
  assert.equal(identityRefusalKey(new ApiRequestError(URL_, 403, 'insufficient_scope', 'x')), null);
  // A plain error whose TEXT happens to be the code is still not the refusal.
  assert.equal(identityRefusalKey(new Error('pollar_identity_mismatch')), null);
  assert.equal(identityRefusalKey(null), null);
});
