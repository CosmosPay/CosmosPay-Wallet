import {
  SIGN_IN_BINDING_KEY_PREFIX,
  SIGN_IN_BINDING_POLL_MS,
  SIGN_IN_BINDING_TTL_MS,
  SIGN_IN_RETURN_PATH,
} from '@/constants/signIn';
import { buildKind } from '@/lib/platform';

/**
 * The device binding of an Authentik emailed sign-in, from the page it lands on to the tab
 * that holds the handshake.
 *
 * The emailed link proves whose inbox it is, not that the wallet holding the handshake is the
 * one in the browser where it was opened: anyone can start a sign-in and send someone its URL.
 * So the community server's callback sends a one-time value to the wallet's return page, in
 * the fragment, and skips its own emailed code only for a claim that presents it. The return
 * page (`src/pages/signed-in.astro`) is a tab of its own; it leaves the value here, in the
 * browser's `localStorage`, for the tab polling that `state` — a wallet in any other browser
 * never sees it, and gets the code.
 */

/**
 * The return page of this build, sent as `returnTo` — or null where the callback cannot reach a
 * page of ours that shares this tab's storage: the extension and the native apps keep the
 * server's own page (and an emailed sign-in there keeps the code).
 */
export function signInReturnUrl(): string | null {
  if (buildKind() !== 'web' || typeof location === 'undefined') return null;
  return new URL(`${import.meta.env?.BASE_URL ?? '/'}${SIGN_IN_RETURN_PATH}`, location.origin).toString();
}

/** What the return page was handed: the URL's query and fragment, read once. */
export interface SignInReturn {
  state: string;
  /** Present only after an emailed sign-in on a server that binds it. */
  binding: string | null;
  /** The server's failure token, when the sign-in did not finish. */
  error: string | null;
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** Parse `?state=…&error=…#binding=…`; null when there is no usable `state`. */
export function readSignInReturn(search: string, hash: string): SignInReturn | null {
  const query = new URLSearchParams(search);
  const state = query.get('state');
  if (!state || !TOKEN.test(state)) return null;
  const binding = new URLSearchParams(hash.replace(/^#/, '')).get('binding');
  return {
    state,
    binding: binding && TOKEN.test(binding) ? binding : null,
    error: query.get('error'),
  };
}

/** The part of `Storage` this needs — `localStorage` in the browser, a map in tests. */
export type BindingStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const keyOf = (state: string) => `${SIGN_IN_BINDING_KEY_PREFIX}${state}`;

/** Leave a binding for the tab that holds `state`; stale ones are dropped on the way. */
export function keepBinding(store: BindingStore, state: string, binding: string, now = Date.now()): void {
  pruneBindings(store, now);
  store.setItem(keyOf(state), JSON.stringify({ binding, at: now }));
}

/** The binding left for `state`, removed as it is read; null when there is none (or it is stale). */
export function takeBinding(store: BindingStore, state: string, now = Date.now()): string | null {
  const raw = store.getItem(keyOf(state));
  if (raw === null) return null;
  store.removeItem(keyOf(state));
  try {
    const kept = JSON.parse(raw) as { binding?: unknown; at?: unknown };
    if (typeof kept.binding !== 'string' || !TOKEN.test(kept.binding)) return null;
    if (typeof kept.at !== 'number' || now - kept.at > SIGN_IN_BINDING_TTL_MS) return null;
    return kept.binding;
  } catch {
    return null;
  }
}

function pruneBindings(store: BindingStore, now: number): void {
  const stale: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(SIGN_IN_BINDING_KEY_PREFIX)) continue;
    try {
      const kept = JSON.parse(store.getItem(key) ?? '') as { at?: unknown };
      if (typeof kept.at !== 'number' || now - kept.at > SIGN_IN_BINDING_TTL_MS) stale.push(key);
    } catch {
      stale.push(key);
    }
  }
  for (const key of stale) store.removeItem(key);
}

/** `localStorage`, or null where it is missing or blocked (a private window, a test). */
export function browserBindingStore(): BindingStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait up to `timeoutMs` for the binding of `state`. Ends early on the other tab's write (the
 * `storage` event) or when `shouldStop` says so; looks again every few hundred milliseconds
 * too, because a browser may coalesce events for a background tab. Null when none came.
 */
export function waitForBinding(state: string, timeoutMs: number, shouldStop: () => boolean): Promise<string | null> {
  const store = browserBindingStore();
  if (!store) return Promise.resolve(null);
  const now = takeBinding(store, state);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: string | null) => {
      if (timer !== null) clearTimeout(timer);
      globalThis.removeEventListener?.('storage', onStorage);
      resolve(value);
    };
    const look = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const found = takeBinding(store, state);
      if (found) return finish(found);
      if (shouldStop() || Date.now() >= deadline) return finish(null);
      timer = setTimeout(look, SIGN_IN_BINDING_POLL_MS);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyOf(state)) look();
    };
    globalThis.addEventListener?.('storage', onStorage);
    timer = setTimeout(look, SIGN_IN_BINDING_POLL_MS);
  });
}
