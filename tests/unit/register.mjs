// Test bootstrap — loaded via `node --import ./tests/unit/register.mjs`.
// 1. Registers the `@/` -> src/ module loader (see loader.mjs).
// 2. Installs a Map-backed localStorage stub so vault/storage tests run outside
//    a browser (Node has no localStorage by default).
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./loader.mjs', import.meta.url);

// --- localStorage stub (kept in sync with the Web Storage API) ---
if (!globalThis.localStorage) {
  const store = new Map();
  const stub = {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
}

// Keep the module URL resolution relative to this file working even if a runner
// imports it from elsewhere.
export const registerUrl = fileURLToPath(import.meta.url);
