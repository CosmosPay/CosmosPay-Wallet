/**
 * The device binding of an Authentik emailed sign-in (src/lib/signInBinding.ts): what the
 * return page reads off its URL, and how it reaches the tab that holds the handshake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepBinding, readSignInReturn, takeBinding, type BindingStore } from '@/lib/signInBinding';
import { SIGN_IN_BINDING_KEY_PREFIX, SIGN_IN_BINDING_TTL_MS } from '@/constants/signIn';

const STATE = 'aW4tYS1yZWFsLXN0YXRlLXRoaXMtd291bGQtYmUtNDM';
const BINDING = 'Ymlu-ZGluZ19zZW50X3RvX3RoaXNfYnJvd3Nlcl9vbmx5';

function memoryStore(): BindingStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

test('the return page reads the state from the query and the binding from the fragment', () => {
  assert.deepEqual(readSignInReturn(`?state=${STATE}`, `#binding=${BINDING}`), {
    state: STATE,
    binding: BINDING,
    error: null,
  });
  assert.deepEqual(readSignInReturn(`?state=${STATE}&error=denied`, ''), {
    state: STATE,
    binding: null,
    error: 'denied',
  });
});

test('a binding in the query is not one: only the fragment stays in the browser', () => {
  assert.equal(readSignInReturn(`?state=${STATE}&binding=${BINDING}`, '')?.binding, null);
});

test('no usable state, nothing to hand over', () => {
  assert.equal(readSignInReturn('', `#binding=${BINDING}`), null);
  assert.equal(readSignInReturn('?state=a<b', ''), null);
  assert.equal(readSignInReturn(`?state=${STATE}`, '#binding=<script>')?.binding, null);
});

test('a kept binding is taken once, by its state', () => {
  const store = memoryStore();
  keepBinding(store, STATE, BINDING, 1000);
  assert.equal(takeBinding(store, 'another-state-of-sixteen+', 1001), null);
  assert.equal(takeBinding(store, STATE, 1001), BINDING);
  assert.equal(takeBinding(store, STATE, 1002), null);
  assert.equal(store.map.size, 0);
});

test('a stale binding is refused and dropped', () => {
  const store = memoryStore();
  keepBinding(store, STATE, BINDING, 1000);
  assert.equal(takeBinding(store, STATE, 1000 + SIGN_IN_BINDING_TTL_MS + 1), null);
  assert.equal(store.map.size, 0);
});

test('keeping one sweeps the stale and the unreadable, and nothing else', () => {
  const store = memoryStore();
  store.setItem(`${SIGN_IN_BINDING_KEY_PREFIX}old`, JSON.stringify({ binding: BINDING, at: 0 }));
  store.setItem(`${SIGN_IN_BINDING_KEY_PREFIX}junk`, '{');
  store.setItem('cosmos.unrelated', 'kept');
  keepBinding(store, STATE, BINDING, SIGN_IN_BINDING_TTL_MS + 10);
  assert.deepEqual([...store.map.keys()].sort(), ['cosmos.unrelated', `${SIGN_IN_BINDING_KEY_PREFIX}${STATE}`].sort());
});
