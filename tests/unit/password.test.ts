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
import { APP_PWD_CRITERIA, MIN_APP_PWD_LEN, appPasswordOk, isCommonPassword } from '@/lib/validate';

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
  //
  // Built FROM the constant rather than typed out, because it WAS typed out — as
  // `Abcdefg1` — and raising the floor turned "the base must be valid" into a failure that
  // said nothing about the criteria it exists to isolate.
  // Varied letters after the base, so it also clears the common-password criterion.
  const valid = `Abc1${'mzqtrwnlpkyh'.slice(0, MIN_APP_PWD_LEN - 4)}`;
  assert.equal(valid.length, MIN_APP_PWD_LEN);
  assert.ok(appPasswordOk(valid), 'the base must be valid or the rest proves nothing');
  assert.equal(appPasswordOk(valid.toLowerCase()), false, 'no uppercase');
  assert.equal(appPasswordOk(valid.toUpperCase()), false, 'no lowercase');
  assert.equal(appPasswordOk(valid.replace('1', 'e')), false, 'no digit');
  assert.equal(appPasswordOk(valid.slice(0, -1)), false, 'one character short');
});

test('the length floor is the exported constant, not a literal in a screen', () => {
  const short = `Ab1${'mzqtrwnlpkyh'.slice(0, MIN_APP_PWD_LEN - 4)}`;
  assert.equal(short.length, MIN_APP_PWD_LEN - 1);
  assert.equal(appPasswordOk(short), false);
  assert.equal(appPasswordOk(`${short}d`), true);
});

test('a long passphrase is not rejected for being long', () => {
  // The ladder in lib/attempts.ts bounds typing; the password's own entropy is what bounds
  // an offline grind of the vault blob. Nothing here may cap length.
  // Varied, not one letter repeated: a repeat is refused on its own terms (see below).
  const long = `A1 ${'correct horse battery staple '.repeat(14)}`;
  assert.ok(long.length > 400);
  assert.ok(appPasswordOk(long));
});

/* The backup is attacked offline, so length alone is not enough: these are long and still
   among the first things a cracking rule tries. */
test('long passwords a guesser tries early are refused', () => {
  for (const pwd of [
    'Password2024!',
    'Contraseña2024',
    'Qwerty123456A',
    'Aaaaaaaaaaa1',
    'Abcdefgh1234',
    'Cosmospay2026!',
    'Zyxwvut98765A',
  ]) {
    assert.ok(pwd.length >= MIN_APP_PWD_LEN, pwd);
    assert.equal(isCommonPassword(pwd), true, pwd);
    assert.equal(appPasswordOk(pwd), false, pwd);
  }
  assert.equal(appPasswordOk('Corr3ct-Horse-Battery'), true);
  assert.equal(appPasswordOk('Mi-gato-come-7-peras'), true);
});
