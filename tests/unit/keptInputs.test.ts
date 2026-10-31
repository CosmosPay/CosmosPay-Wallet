/**
 * What a flow keeps while the person walks back and forth (src/lib/keptInputs.ts): kept by
 * key, forgotten one by one or all at once when the flow ends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetKeptInput, forgetKeptInputs, keepInput, keptInput } from '@/lib/keptInputs';
import { KEPT_INPUT } from '@/constants/keptInputs';

test('an input is kept by its key, and forgotten on its own', () => {
  keepInput(KEPT_INPUT.signInEmail, 'ada@example.com');
  keepInput(KEPT_INPUT.backupTerms, true);
  assert.equal(keptInput(KEPT_INPUT.signInEmail), 'ada@example.com');
  forgetKeptInput(KEPT_INPUT.signInEmail);
  assert.equal(keptInput(KEPT_INPUT.signInEmail), undefined);
  assert.equal(keptInput(KEPT_INPUT.backupTerms), true);
  forgetKeptInputs();
});

test('a finished flow forgets everything it kept', () => {
  keepInput(KEPT_INPUT.backupSaved, true);
  keepInput(KEPT_INPUT.backupChoice, 'words');
  forgetKeptInputs();
  for (const key of Object.values(KEPT_INPUT)) assert.equal(keptInput(key), undefined, key);
});

test('every key is its own', () => {
  const keys = Object.values(KEPT_INPUT);
  assert.equal(new Set(keys).size, keys.length);
});
