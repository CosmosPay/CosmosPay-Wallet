import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStellarQr, buildSep7Pay } from '@/lib/sep7';

const G = 'GCMKX4FTMQ3AEIB7OIV457RZ3E6CAI7OM6SHSOHWXZQA5TZRKR55PD6Z';

test('buildSep7Pay emits a web+stellar:pay URI', () => {
  const uri = buildSep7Pay({ destination: G, amount: '10', memo: 'hi', assetCode: 'USDC', assetIssuer: G });
  assert.ok(uri.startsWith('web+stellar:pay?destination='));
  assert.ok(uri.includes('amount=10'));
  assert.ok(uri.includes('memo=hi'));
  assert.ok(uri.includes('asset_code=USDC'));
  assert.ok(uri.includes('memo_type=MEMO_TEXT'));
});

test('parseStellarQr accepts a full pay URI', () => {
  const parsed = parseStellarQr(`web+stellar:pay?destination=${G}&amount=10&memo=hi&memo_type=MEMO_TEXT&asset_code=USDC&asset_issuer=${G}`);
  assert.deepEqual(parsed, {
    destination: G,
    amount: '10',
    memo: 'hi',
    memoType: 'MEMO_TEXT',
    assetCode: 'USDC',
    assetIssuer: G,
  });
});

test('parseStellarQr accepts a bare address and a stellar: prefix', () => {
  assert.deepEqual(parseStellarQr(G), { destination: G });
  assert.deepEqual(parseStellarQr(`stellar:${G}`), { destination: G });
});

test('parseStellarQr rejects non-pay ops and invalid addresses', () => {
  assert.equal(parseStellarQr('web+stellar:tx?xdr=abc'), null);
  assert.equal(parseStellarQr('web+stellar:pay?destination=not-a-key'), null);
  assert.equal(parseStellarQr(''), null);
  assert.equal(parseStellarQr('hello world'), null);
});

test('parseStellarQr drops non-text/non-id memos', () => {
  const base = `web+stellar:pay?destination=${G}&memo=abc`;
  assert.equal(parseStellarQr(`${base}&memo_type=MEMO_HASH`)?.memo, undefined);
  assert.equal(parseStellarQr(`${base}&memo_type=MEMO_ID`)?.memo, 'abc');
});
