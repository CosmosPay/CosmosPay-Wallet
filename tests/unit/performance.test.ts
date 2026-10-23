/**
 * The Performance panel's arithmetic (`lib/performance.ts`) and the activity grouping
 * (`lib/activity.ts`): what the redesigned Home claims about the portfolio has to add up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOCATION_SLICES, allocationByAsset, allocationByNetwork, movers } from '@/lib/performance';
import { groupByDay } from '@/lib/activity';
import { widthRung } from '@/lib/rung';
import type { AssetRow } from '@/lib/portfolio';
import type { HistoryOp } from '@/lib/stellar';

const row = (code: string, value: number | null, chain?: AssetRow['chain']): AssetRow => ({
  code,
  issuer: null,
  amount: 1,
  price: value,
  value,
  isNative: code === 'XLM' && !chain,
  ...(chain ? { chain, asset: 'native' } : {}),
});

test('one coin on several chains is one slice; shares add up to the whole', () => {
  const rows = [row('ETH', 300, 'ethereum'), row('ETH', 100, 'arbitrum'), row('USDC', 100, 'base'), row('XLM', 0)];
  const slices = allocationByAsset(rows);
  assert.deepEqual(slices.map((s) => s.code), ['ETH', 'USDC']);
  assert.equal(slices[0].value, 400);
  const total = slices.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('past the cap the remainder is folded into one slice, and unpriced rows count for nothing', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => row(c, 100 - i));
  rows.push(row('UNPRICED', null));
  const slices = allocationByAsset(rows);
  assert.equal(slices.length, ALLOCATION_SLICES + 1);
  assert.equal(slices.at(-1)!.code, '…');
  assert.ok(!slices.some((s) => s.code === 'UNPRICED'));
});

test('an empty or unpriced portfolio has no allocation at all', () => {
  assert.deepEqual(allocationByAsset([]), []);
  assert.deepEqual(allocationByAsset([row('X', null)]), []);
  assert.deepEqual(allocationByNetwork([row('X', 0)]), []);
});

test('the network split puts each holding on the chain that holds it', () => {
  const nets = allocationByNetwork([row('XLM', 50), row('USDC', 25), row('ETH', 80, 'arbitrum'), row('BTC', 100, 'bitcoin')]);
  assert.deepEqual(nets.map((n) => n.network), ['bitcoin', 'arbitrum', 'stellar']);
  assert.equal(nets.find((n) => n.network === 'stellar')!.value, 75);
  assert.equal(nets.find((n) => n.network === 'arbitrum')!.logo, 'ETH');
});

test('movers are ordered by the size of the move, a fall as much as a rise', () => {
  const prices = { BTC: { usd: 1, change24h: 2 }, ETH: { usd: 1, change24h: -5 }, SOL: { usd: 1, change24h: 1 } };
  const m = movers([row('BTC', 1), row('ETH', 1, 'ethereum'), row('ETH', 1, 'base'), row('SOL', 1), row('NOPRICE', 1)], prices);
  assert.deepEqual(m.map((x) => x.code), ['ETH', 'BTC', 'SOL']);
});

test('a sliver still shows as a sliver, never as nothing', () => {
  assert.equal(widthRung(0), 'is-w-0');
  assert.equal(widthRung(0.001), 'is-w-1');
  assert.equal(widthRung(0.5), 'is-w-10');
  assert.equal(widthRung(1), 'is-w-20');
  assert.equal(widthRung(7), 'is-w-20');
  assert.equal(widthRung(Number.NaN), 'is-w-0');
});

const op = (id: string, createdAt: string): HistoryOp => ({
  id,
  kind: 'received',
  createdAt,
  code: 'XLM',
  amount: '1',
  counterparty: null,
  hash: id,
  failed: false,
});

test('activity is grouped by local day, newest day first, with today and yesterday named', () => {
  const now = new Date(2026, 9, 23, 15, 0);
  const days = groupByDay(
    [
      op('a', new Date(2026, 9, 23, 9, 51).toISOString()),
      op('b', new Date(2026, 9, 23, 10, 24).toISOString()),
      op('c', new Date(2026, 9, 22, 23, 59).toISOString()),
      op('d', new Date(2026, 9, 10, 15, 42).toISOString()),
    ],
    now,
  );
  assert.deepEqual(days.map((d) => d.relative), ['today', 'yesterday', null]);
  assert.deepEqual(days.map((d) => d.items.map((i) => i.id)), [['a', 'b'], ['c'], ['d']]);
});

test('an operation whose time does not parse is kept, under the oldest day', () => {
  const days = groupByDay([op('ok', new Date(2026, 0, 2).toISOString()), op('bad', 'not a date')], new Date(2026, 0, 2));
  assert.equal(days.at(-1)!.items[0].id, 'bad');
});
