/**
 * The activity list in days (src/lib/activity.ts): runs of one local day, and which of them
 * are "today" and "yesterday".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, localDay, relativeDay } from '@/lib/activity';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test('operations fall into runs of one local day, in the order they came', () => {
  const items = [
    { id: 'a', createdAt: at(2026, 10, 28, 18) },
    { id: 'b', createdAt: at(2026, 10, 28, 9) },
    { id: 'c', createdAt: at(2026, 10, 27, 23) },
    { id: 'd', createdAt: at(2026, 10, 10) },
  ];
  const days = groupByDay(items);
  assert.deepEqual(
    days.map((d) => [d.day, d.items.map((i) => i.id)]),
    [
      ['2026-10-28', ['a', 'b']],
      ['2026-10-27', ['c']],
      ['2026-10-10', ['d']],
    ],
  );
});

test('today and yesterday are named; any other day is left to the caller', () => {
  const now = new Date(2026, 9, 28, 10);
  assert.equal(relativeDay(localDay(now), now), 'today');
  assert.equal(relativeDay('2026-10-27', now), 'yesterday');
  assert.equal(relativeDay('2026-10-26', now), null);
});

test('yesterday crosses a month', () => {
  const now = new Date(2026, 10, 1, 8);
  assert.equal(relativeDay('2026-10-31', now), 'yesterday');
});
