/**
 * The flow as browser history (src/lib/navHistory.ts): what an entry carries, which entries
 * are this page load's, and how the browser is brought in line with the app's path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navState, planSync, readNavState, samePath, type NavPlace } from '@/lib/navHistory';

const PATH: NavPlace[] = [{ screen: 'welcome' }, { screen: 'sign-in', step: 'email' }, { screen: 'sign-in', step: 'code' }];

test('an entry carries the whole path and reads back the same', () => {
  const state = navState('load-1', PATH);
  assert.deepEqual(readNavState(state, 'load-1'), PATH);
  // A copy: the store keeps mutating its own stack after the entry is written.
  assert.notEqual(state.path[1], PATH[1]);
});

test('only this page load adopts an entry', () => {
  const state = navState('load-1', PATH);
  assert.equal(readNavState(state, 'load-2'), null);
  assert.equal(readNavState(null, 'load-1'), null);
  // `readIncomingSep7` and other code may leave entries of their own.
  assert.equal(readNavState({ foo: 1 }, 'load-1'), null);
});

test('an entry naming a screen this build does not have is refused', () => {
  assert.equal(readNavState({ cosmosNav: 'x', path: [{ screen: 'nope' }] }, 'x'), null);
  assert.equal(readNavState({ cosmosNav: 'x', path: [] }, 'x'), null);
  assert.equal(readNavState({ cosmosNav: 'x', path: [{ screen: 'welcome', step: 3 }] }, 'x'), null);
});

test('places compare by screen AND step', () => {
  assert.ok(samePath(PATH, navState('a', PATH).path));
  assert.ok(!samePath(PATH, [...PATH.slice(0, 2), { screen: 'sign-in' }]));
  assert.ok(!samePath(PATH, PATH.slice(0, 2)));
});

test('a step forward is a new entry, so it is a stop on the way back', () => {
  assert.deepEqual(planSync(1, PATH), { kind: 'push', from: 2 });
  // Two steps in one commit still get one entry each.
  assert.deepEqual(planSync(0, PATH), { kind: 'push', from: 1 });
});

test('the same depth replaces, a shallower path rewinds', () => {
  assert.deepEqual(planSync(2, PATH), { kind: 'replace' });
  // The app's own back button, or a lock that empties the stack.
  assert.deepEqual(planSync(4, PATH), { kind: 'rewind', delta: -2 });
  assert.deepEqual(planSync(3, [{ screen: 'unlock' }]), { kind: 'rewind', delta: -3 });
});
