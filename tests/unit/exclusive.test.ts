/**
 * One-at-a-time execution for the money flows.
 *
 * This was five hand-written claim/release pairs inside the store hook, where no test
 * could reach them — and it is the newest logic in the signing path: a double-tap in
 * the frame before the confirmation overlay paints is the difference between one
 * payment and two.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExclusiveRunner } from '@/lib/exclusive';

/** A promise plus the handle to settle it, so a "still running" flow can be held open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a second run while the first is in flight does not execute', async () => {
  const ex = createExclusiveRunner();
  const gate = deferred<string>();
  let calls = 0;

  const first = ex.run('send', () => {
    calls++;
    return gate.promise;
  });
  const second = await ex.run('send', async () => {
    calls++;
    return 'second';
  });

  assert.equal(second.ran, false);
  assert.equal(calls, 1);

  gate.resolve('first');
  assert.deepEqual(await first, { ran: true, value: 'first' });
});

test('the claim is released once the flow settles, however it settles', async () => {
  const ex = createExclusiveRunner();
  await ex.run('swap', async () => 1);
  assert.deepEqual(await ex.run('swap', async () => 2), { ran: true, value: 2 });

  // A throw must release too — otherwise one failed swap kills the button until reload.
  await assert.rejects(ex.run('swap', async () => Promise.reject(new Error('boom'))));
  assert.deepEqual(await ex.run('swap', async () => 3), { ran: true, value: 3 });
});

test('different flows do not block each other', async () => {
  const ex = createExclusiveRunner();
  const gate = deferred<void>();
  const held = ex.run('send', () => gate.promise);
  assert.deepEqual(await ex.run('offramp', async () => 'ok'), { ran: true, value: 'ok' });
  gate.resolve();
  await held;
});

test('clear() frees a slot whose flow was abandoned', async () => {
  // `lock()` calls this: a flow left in flight with the session gone must not keep its
  // slot held for the next unlock.
  const ex = createExclusiveRunner();
  const gate = deferred<void>();
  const held = ex.run('lp-deposit', () => gate.promise);
  assert.equal((await ex.run('lp-deposit', async () => 1)).ran, false);

  ex.clear();
  assert.deepEqual(await ex.run('lp-deposit', async () => 1), { ran: true, value: 1 });
  gate.resolve();
  await held;
});
