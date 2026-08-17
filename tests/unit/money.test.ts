import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spendableXlm,
  availableBalance,
  decideSend,
  decideSwap,
  decideLpDeposit,
  decideLpWithdraw,
  decideFiatAmount,
} from '@/lib/money';

test('spendableXlm keeps the base reserve + fee buffer free', () => {
  // 2 subentries -> 2 XLM reserve + 0.001 fee buffer.
  assert.equal(spendableXlm(10, 2), 10 - 2 - 0.001);
  assert.equal(spendableXlm(2, 2), 0); // nothing left after reserve
  assert.equal(spendableXlm(0, 0), 0);
  assert.equal(spendableXlm(1, 0), 1 - 1 - 0.001 > 0 ? 1 - 1 - 0.001 : 0); // clamps at 0
});

test('availableBalance is reserve-aware for XLM, raw for credit assets', () => {
  assert.equal(availableBalance('XLM', true, '10', 10, 2), spendableXlm(10, 2));
  assert.equal(availableBalance('USDC', false, '42.5', 10, 2), 42.5);
  assert.equal(availableBalance('USDC', false, 'garbage', 10, 2), 0);
});

test('decideSend requires a valid address, amount within balance, and a short memo', () => {
  const validAddr = 'GCMKX4FTMQ3AEIB7OIV457RZ3E6CAI7OM6SHSOHWXZQA5TZRKR55PD6Z';
  assert.deepEqual(decideSend(validAddr, '5', '', 10), { addressValid: true, amountValid: true, memoValid: true, ok: true });
  assert.equal(decideSend('not-an-address', '5', '', 10).ok, false);
  assert.equal(decideSend(validAddr, '15', '', 10).ok, false); // over balance
  assert.equal(decideSend(validAddr, '0', '', 10).ok, false);
  assert.equal(decideSend(validAddr, '5', 'a'.repeat(29), 10).ok, false); // memo too long
});

test('decideSwap flags insufficient and blocks same-asset', () => {
  assert.deepEqual(decideSwap('5', 10, false), { insufficient: false, ok: true });
  assert.equal(decideSwap('15', 10, false).insufficient, true);
  assert.equal(decideSwap('15', 10, false).ok, false);
  assert.equal(decideSwap('5', 10, true).ok, false); // same asset
  assert.equal(decideSwap('0', 10, false).ok, false);
});

test('decideLpDeposit guards both sides (amountB optional)', () => {
  assert.deepEqual(decideLpDeposit('5', undefined, 10, 10, false), { overA: false, overB: false, ok: true });
  assert.equal(decideLpDeposit('15', undefined, 10, 10, false).overA, true);
  assert.equal(decideLpDeposit('5', '20', 10, 10, false).overB, true);
  assert.equal(decideLpDeposit('5', '8', 10, 10, true).ok, false); // same asset
  assert.equal(decideLpDeposit('0', undefined, 10, 10, false).ok, false);
});

test('decideLpWithdraw blocks burning more shares than held', () => {
  assert.deepEqual(decideLpWithdraw('5', 10), { over: false, ok: true });
  assert.equal(decideLpWithdraw('15', 10).over, true);
  assert.equal(decideLpWithdraw('15', 10).ok, false);
  assert.equal(decideLpWithdraw('0', 10).ok, false);
});

test('decideFiatAmount requires >= 0.01 and within balance', () => {
  assert.deepEqual(decideFiatAmount('100', 500), { insufficient: false, ok: true });
  assert.equal(decideFiatAmount('600', 500).insufficient, true);
  assert.equal(decideFiatAmount('0.004', 500).ok, false); // below one minor unit
  assert.equal(decideFiatAmount('', 500).ok, false);
});
