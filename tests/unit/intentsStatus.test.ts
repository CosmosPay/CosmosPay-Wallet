/**
 * The swap tracker's reading of 1Click (`lib/intentsStatus.ts`). It is display only, so what
 * matters is that it never shows an outcome the swap did not reach: an unknown status is
 * "still waiting", and a payout link that is not https is dropped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntentsStatus, trackerState } from '@/lib/intentsStatus';

test('each 1Click status puts the tracker on its step', () => {
  assert.deepEqual(trackerState('PENDING_DEPOSIT'), { done: 1, outcome: null });
  assert.deepEqual(trackerState('KNOWN_DEPOSIT_TX'), { done: 2, outcome: null });
  assert.deepEqual(trackerState('INCOMPLETE_DEPOSIT'), { done: 2, outcome: null });
  assert.deepEqual(trackerState('PROCESSING'), { done: 3, outcome: null });
  assert.deepEqual(trackerState('SUCCESS'), { done: 4, outcome: 'ok' });
  assert.deepEqual(trackerState('REFUNDED'), { done: 4, outcome: 'refunded' });
  assert.deepEqual(trackerState('FAILED'), { done: 4, outcome: 'failed' });
});

test('a body that is not a known status reads as unknown, never as an outcome', () => {
  assert.equal(parseIntentsStatus(null), null);
  assert.equal(parseIntentsStatus({ status: 'DONE' }), null);
  assert.equal(parseIntentsStatus({ message: 'Deposit address not found', statusCode: 404 }), null);
});

test('the delivered amount and the payout transaction are read, and only https links kept', () => {
  const p = parseIntentsStatus({
    status: 'SUCCESS',
    swapDetails: {
      amountOut: '23985374',
      amountOutFormatted: '23.985374',
      destinationChainTxHashes: [
        { hash: '0xabc', explorerUrl: 'https://arbiscan.io/tx/0xabc' },
        { hash: '0xdef', explorerUrl: 'javascript:alert(1)' },
        { nope: true },
      ],
    },
  });
  assert.equal(p?.amountOut, '23.985374');
  assert.deepEqual(p?.destinationTx, [
    { hash: '0xabc', explorerUrl: 'https://arbiscan.io/tx/0xabc' },
    { hash: '0xdef', explorerUrl: null },
  ]);
  assert.equal(parseIntentsStatus({ status: 'PROCESSING', swapDetails: { amountOut: '0', amountOutFormatted: '0' } })?.amountOut, null);
});
