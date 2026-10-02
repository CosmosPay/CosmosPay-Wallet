/**
 * The XLM an account can spend, and what recovery still needs of it.
 *
 * Recovery is paid by the account itself — there is no sponsored path — so the shortfall
 * is the number the screens show and the number `enableRecovery` checks before either
 * server hears of the account. It must count the reserve the account already carries:
 * a fixed total would under-ask an account with trustlines and over-ask a new one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryShortfall, spendableXlm } from '@/lib/balances';
import { RECOVERY_MIN_SPENDABLE_XLM } from '@/constants/recovery';
import type { AccountState } from '@/lib/stellar';

const acct = (xlm: number, subentryCount = 0): AccountState => ({ exists: true, balances: [], xlm, subentryCount });

test('spendable XLM leaves the base reserve and every subentry untouched', () => {
  assert.equal(spendableXlm(null), 0);
  assert.equal(spendableXlm({ exists: false, balances: [], xlm: 0, subentryCount: 0 }), 0);
  // A new account: 1 XLM minimum. Two trustlines: 2 XLM.
  assert.ok(Math.abs(spendableXlm(acct(5)) - 3.999) < 1e-9);
  assert.ok(Math.abs(spendableXlm(acct(5, 2)) - 2.999) < 1e-9);
});

test('recovery needs the reserve and the fee margin free, on top of what the account holds', () => {
  assert.equal(RECOVERY_MIN_SPENDABLE_XLM, 1.5);
  // Plenty: nothing missing.
  assert.equal(recoveryShortfall(acct(10)), 0);
  // A new account at 2 XLM has ~1 free, so ~0.5 is missing — rounded UP, never under-asked.
  assert.equal(recoveryShortfall(acct(2)), 0.51);
  // The same balance with two trustlines has nothing free: the whole 1.5 is missing.
  assert.equal(recoveryShortfall(acct(2, 2)), 1.5);
  // Three trustlines at 3 XLM: 2.5 is the minimum, so only ~0.5 is free — a total of 3
  // XLM is not enough, which is why the check is never a fixed balance.
  assert.equal(recoveryShortfall(acct(3, 3)), 1.01);
});

test('an account that does not exist yet is missing the whole amount', () => {
  assert.equal(recoveryShortfall(null), RECOVERY_MIN_SPENDABLE_XLM);
});
