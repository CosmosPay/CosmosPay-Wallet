import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionEpoch } from '@/lib/epoch';

test('epoch starts at 0 and increments', () => {
  const epoch = createSessionEpoch();
  assert.equal(epoch.get(), 0);
  epoch.increment();
  assert.equal(epoch.get(), 1);
});

test('guard allows matching epoch', () => {
  const epoch = createSessionEpoch();
  const current = epoch.get();
  // should not throw
  epoch.guard(current, 'locked');
});

test('guard throws if epoch does not match', () => {
  const epoch = createSessionEpoch();
  const current = epoch.get();
  epoch.increment();
  assert.throws(() => {
    epoch.guard(current, 'locked');
  }, /locked/);
});
