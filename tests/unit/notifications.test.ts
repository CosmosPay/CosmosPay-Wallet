/**
 * The notifications bell (src/lib/notifications.ts). What is pinned: it lists what happened to
 * the account and never the commissions; what is new is what came after the last look; and a
 * wallet's first look starts with everything seen — the whole history is not "new".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFY_ROWS } from '@/constants/home';
import { isUnread, notificationsOf, readSeen, unreadCount, writeSeen } from '@/lib/notifications';
import type { HistoryOp } from '@/lib/stellar';

const op = (id: string, kind: HistoryOp['kind'], createdAt: string): HistoryOp => ({
  id,
  kind,
  createdAt,
  code: 'XLM',
  amount: '1',
  counterparty: null,
  hash: id,
  failed: false,
});

test('payments, swaps and the account’s creation are listed; commissions and the rest are not', () => {
  const list = notificationsOf([
    op('a', 'received', '2026-10-29T10:00:00Z'),
    op('b', 'fee', '2026-10-29T09:00:00Z'),
    op('c', 'swap', '2026-10-29T08:00:00Z'),
    op('d', 'other', '2026-10-29T07:00:00Z'),
    op('e', 'sent', '2026-10-29T06:00:00Z'),
    op('f', 'create', '2026-10-29T05:00:00Z'),
  ]);
  assert.deepEqual(
    list.map((o) => o.id),
    ['a', 'c', 'e', 'f'],
  );
  const many = Array.from({ length: 40 }, (_, i) => op(String(i), 'received', `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`));
  assert.equal(notificationsOf(many).length, NOTIFY_ROWS);
});

test('new is what came after the last look; with no look yet nothing is new', () => {
  const items = [op('a', 'received', '2026-10-29T10:00:00Z'), op('b', 'sent', '2026-10-29T08:00:00Z')];
  assert.equal(unreadCount(items, '2026-10-29T09:00:00Z'), 1);
  assert.equal(isUnread(items[0], '2026-10-29T10:00:00Z'), false);
  assert.equal(unreadCount(items, null), 0);
});

test('a first look is recorded as now, and a later one is read back', async () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.equal(await readSeen('w-test', 'testnet', now), now.toISOString());
  await writeSeen('w-test', 'testnet', '2026-10-29T13:00:00Z');
  assert.equal(await readSeen('w-test', 'testnet'), '2026-10-29T13:00:00Z');
  // another network of the same wallet keeps its own
  assert.equal(await readSeen('w-test', 'mainnet', now), now.toISOString());
});
