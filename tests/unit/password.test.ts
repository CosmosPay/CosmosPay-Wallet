/**
 * The rule that decides what may seal a vault (`src/lib/validate.ts`).
 *
 * Worth a test because the failure it guards was silent and already shipped: the rule was
 * re-derived in two screens and they DISAGREED. Onboarding demanded 8 characters plus an
 * upper, a lower and a digit — three bare regexes and a bare `8` inside a `.tsx` — while
 * the change-password form demanded length alone, and neither the store nor
 * `vault.changePassword` re-checked anything. A wallet created under the strict rule could
 * be re-sealed under `aaaaaaaa` a minute later, taking every device-lock envelope with it.
 *
 * So what is asserted here is not "the regexes work" but the property that made the bug
 * possible: there is ONE rule, and `appPasswordOk` is exactly the conjunction of the
 * criteria the onboarding checklist renders. A screen that adds a criterion of its own, or
 * a store that forgets one, breaks this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_PWD_CRITERIA, MIN_APP_PWD_LEN, appPasswordOk } from '@/lib/validate';

test('the rule is exactly the criteria the checklist shows — no more, no less', () => {
  const samples = [
    'Abcdefg1',
    'aaaaaaaa',
    'AAAAAAAA',
    '12345678',
    'Abc1',
    'Abcdefgh',
    'abcdefg1',
    'ABCDEFG1',
    '',
    'Corr3ct-Horse-Battery',
  ];
  for (const pwd of samples) {
    const all = Object.values(APP_PWD_CRITERIA).every((met) => met(pwd));
    assert.equal(appPasswordOk(pwd), all, `"${pwd}"`);
  }
});

test('each criterion is the one thing missing from an otherwise valid password', () => {
  // One base that passes, minus one property at a time. This is what catches a criterion
  // that silently stops being checked: the password differs from the valid one in exactly
  // the way the criterion names.
  assert.ok(appPasswordOk('Abcdefg1'), 'the base must be valid or the rest proves nothing');
  assert.equal(appPasswordOk('abcdefg1'), false, 'no uppercase');
  assert.equal(appPasswordOk('ABCDEFG1'), false, 'no lowercase');
  assert.equal(appPasswordOk('Abcdefgh'), false, 'no digit');
  assert.equal(appPasswordOk('Abcdef1'), false, 'one character short');
});

test('the length floor is the exported constant, not a literal in a screen', () => {
  const short = `Ab1${'c'.repeat(MIN_APP_PWD_LEN - 4)}`;
  assert.equal(short.length, MIN_APP_PWD_LEN - 1);
  assert.equal(appPasswordOk(short), false);
  assert.equal(appPasswordOk(`${short}d`), true);
});

test('a long passphrase is not rejected for being long', () => {
  // The ladder in lib/attempts.ts bounds typing; the password's own entropy is what bounds
  // an offline grind of the vault blob. Nothing here may cap length.
  assert.ok(appPasswordOk(`A1${'x'.repeat(400)}`));
});
