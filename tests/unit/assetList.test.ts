/**
 * Home's asset list (src/lib/assetList.ts). What is pinned: a coin at zero off Stellar is not
 * listed while Stellar's trustlines are; the network filter offers every network it is told
 * about, the held ones first by value and the rest saying whether nothing is there or nothing
 * could be read; and the search finds an asset by name, symbol or network, accents aside.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldText, listedRows, networkSummaries, rowMatches } from '@/lib/assetList';
import type { AssetRow } from '@/lib/portfolio';

const row = (code: string, amount: number, value: number | null, where: Partial<AssetRow> = {}): AssetRow => ({
  code,
  issuer: null,
  amount,
  price: value === null ? null : amount ? value / amount : 0,
  value,
  isNative: false,
  ...where,
});

test('off Stellar only a balance above zero is listed; Stellar keeps its trustlines at zero', () => {
  const rows = [
    row('XLM', 10, 1, { isNative: true }),
    row('USDC', 0, 0),
    row('SOL', 0, 0, { chain: 'solana', asset: 'native' }),
    row('MON', 2, 0.04, { chain: 'monad', asset: 'native' }),
    row('ETH', 0.5, 1500, { network: 'base', asset: 'native' }),
  ];
  assert.deepEqual(
    listedRows(rows).map((r) => r.code),
    ['XLM', 'USDC', 'MON', 'ETH'],
  );
});

test('the filter: held networks first by value, then the rest in registry order, each saying what it knows', () => {
  const rows = listedRows([
    row('XLM', 10, 1, { isNative: true }),
    row('MON', 2, 0.04, { chain: 'monad', asset: 'native' }),
    row('ETH', 0.5, 1500, { network: 'base', asset: 'native' }),
    row('USDC', 20, 20, { network: 'base', asset: '0xusdc' }),
  ]);
  const sums = networkSummaries(rows, ['stellar', 'solana', 'monad', 'eth', 'base', 'btc'], (id) => id !== 'btc');
  assert.deepEqual(
    sums.map((s) => [s.id, s.status, s.count]),
    [
      ['base', 'held', 2],
      ['stellar', 'held', 1],
      ['monad', 'held', 1],
      ['solana', 'empty', 0],
      ['eth', 'empty', 0],
      ['btc', 'unknown', 0],
    ],
  );
  assert.equal(sums[0].value, 1520);
});

test('a network whose assets have no price has no value, not a wrong one', () => {
  const sums = networkSummaries([row('ABC', 3, null, { network: 'eth', asset: '0xabc' })], ['eth'], () => true);
  assert.equal(sums[0].value, null);
});

test('the search: name, symbol or network, every word, accents and case aside', () => {
  const fields = ['USD Coin', 'USDC', 'Base'];
  assert.ok(rowMatches('usdc', fields));
  assert.ok(rowMatches('usd base', fields));
  assert.ok(!rowMatches('usdc ethereum', fields));
  assert.ok(rowMatches('', fields));
  assert.ok(rowMatches('publica', ['Stellar Lumens', 'XLM', 'Stellar Pública']));
  assert.equal(foldText('  Pública '), 'publica');
});

test('a token the person added is listed at zero, like a trustline', () => {
  const rows = [row('BRETT', 0, 0, { network: 'base', asset: '0xb', added: true }), row('ETH', 0, 0, { network: 'base', asset: 'native' })];
  assert.deepEqual(
    listedRows(rows).map((r) => r.code),
    ['BRETT'],
  );
});
