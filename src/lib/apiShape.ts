/**
 * Runtime contracts for API responses.
 *
 * `cosmospay.ts` used to end every request with `return json as T` — a cast, which
 * is a promise to the compiler and nothing at all at runtime. The wallet then read
 * amounts off that object, showed them to the user, and in four places handed the
 * `xdr` field to its signing key.
 *
 * Two deliberate design choices:
 *
 *  1. **Strict on what we act on, lenient on the rest.** Unknown and extra keys pass
 *     through untouched, and only declared fields are asserted. This client ships
 *     through app stores and MV3 review, so installed copies run weeks behind the
 *     server; a contract that rejected a newly-added field would brick a released
 *     wallet over a change that harmed nobody. Assert `xdr`, ids and amounts —
 *     the things a wrong value actually costs money on — and let `createdAt` be
 *     whatever it is.
 *
 *  2. **The contract is a required parameter** of the transport helpers, so a new
 *     endpoint cannot quietly opt out the way a `as T` cast always could.
 *
 * Zero dependencies: this is ~120 lines against valibot's ~1 kB floor plus a second
 * schema dialect for contributors to learn.
 *
 * This used to add "in a repo whose build already fails on unexpected transitive
 * dependencies (see astro.config.ts)". It does not: that hook is a DENYLIST of four
 * package names (`elliptic`, `browserify-sign`, `create-ecdh`, `crypto-browserify`)
 * matched against emitted chunk ids. Any other transitive dependency ships without a
 * word. `paths.test.ts` kept the sentence green because the file it cited exists —
 * which is exactly the class of false claim that test cannot see.
 */

export class ApiShapeError extends Error {
  readonly url: string;
  readonly path: string;
  constructor(url: string, path: string, expected: string, got: unknown) {
    super(`Unexpected server response at ${path || 'the root'}: expected ${expected}, got ${describe(got)} (${url})`);
    this.name = 'ApiShapeError';
    this.url = url;
    this.path = path;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

/** A field contract: validate `v`, or throw. `path` is for the error message. */
export type Check<T> = (v: unknown, path: string, url: string) => T;

/* ------------------------------- scalars -------------------------------- */

/** Explicitly "we do not act on this" — documents the decision instead of hiding it. */
export const unchecked: Check<unknown> = (v) => v;

export const str: Check<string> = (v, path, url) => {
  if (typeof v !== 'string') throw new ApiShapeError(url, path, 'a string', v);
  return v;
};

export const num: Check<number> = (v, path, url) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiShapeError(url, path, 'a number', v);
  return v;
};

export const bool: Check<boolean> = (v, path, url) => {
  if (typeof v !== 'boolean') throw new ApiShapeError(url, path, 'a boolean', v);
  return v;
};

/** A non-empty id we will put back into a follow-up request URL. */
export const id: Check<string> = (v, path, url) => {
  const s = str(v, path, url);
  if (!s.trim()) throw new ApiShapeError(url, path, 'a non-empty id', v);
  return s;
};

/** A decimal amount string, as Stellar and the gateway exchange them. */
export const amount: Check<string> = (v, path, url) => {
  const s = str(v, path, url);
  if (!/^\d+(\.\d+)?$/.test(s.trim())) throw new ApiShapeError(url, path, 'a decimal amount', v);
  return s;
};

/**
 * A base64 transaction envelope. Shape only — that it is a *safe* transaction is
 * decided by lib/txGuard.ts, which decodes it. This stops the obvious garbage
 * (`extractUnsignedXdr` returning a description string) before it gets that far.
 */
export const xdr: Check<string> = (v, path, url) => {
  const s = str(v, path, url).trim();
  if (s.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(s)) throw new ApiShapeError(url, path, 'a base64 XDR', v);
  return s;
};

/** A Stellar account id (shape; the SDK does the checksum where it matters). */
export const account: Check<string> = (v, path, url) => {
  const s = str(v, path, url).trim();
  if (!/^G[A-Z2-7]{55}$/.test(s)) throw new ApiShapeError(url, path, 'a Stellar account (G…)', v);
  return s;
};

/* ------------------------------ combinators ----------------------------- */

/** Absent or null are both accepted, and both come back as undefined. */
export function optional<T>(check: Check<T>): Check<T | undefined> {
  return (v, path, url) => (v === undefined || v === null ? undefined : check(v, path, url));
}

export function nullable<T>(check: Check<T>): Check<T | null> {
  return (v, path, url) => (v === null || v === undefined ? null : check(v, path, url));
}

export function arrayOf<T>(check: Check<T>): Check<T[]> {
  return (v, path, url) => {
    if (!Array.isArray(v)) throw new ApiShapeError(url, path, 'an array', v);
    return v.map((item, i) => check(item, `${path}[${i}]`, url));
  };
}

/**
 * Assert the declared keys of an object and return it **unchanged** — extra keys are
 * preserved, not stripped, so a server that adds a field breaks nothing.
 */
export function object<S extends Record<string, Check<unknown>>>(
  shape: S,
): Check<{ [K in keyof S]: S[K] extends Check<infer U> ? U : never }> {
  return (v, path, url) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiShapeError(url, path, 'an object', v);
    const source = v as Record<string, unknown>;
    for (const key of Object.keys(shape)) {
      shape[key](source[key], path ? `${path}.${key}` : key, url);
    }
    return v as never;
  };
}

/**
 * Discriminated union keyed on a literal field, e.g. `{ status: 'ready' | 'expired' }`.
 * An unrecognised discriminant is an error rather than a silent fall-through — the
 * wallet's `switch` on `status` would otherwise take a default branch on a typo.
 */
export function variant<T>(key: string, cases: Record<string, Check<unknown>>): Check<T> {
  return (v, path, url) => {
    if (!v || typeof v !== 'object') throw new ApiShapeError(url, path, 'an object', v);
    const tag = (v as Record<string, unknown>)[key];
    if (typeof tag !== 'string' || !(tag in cases)) {
      throw new ApiShapeError(url, path ? `${path}.${key}` : key, `one of: ${Object.keys(cases).join(', ')}`, tag);
    }
    cases[tag](v, path, url);
    return v as T;
  };
}

/** Accept either branch; used where the gateway returns a bare array or an envelope. */
export function either<A, B>(a: Check<A>, b: Check<B>): Check<A | B> {
  return (v, path, url) => {
    try {
      return a(v, path, url);
    } catch {
      return b(v, path, url);
    }
  };
}

/** Run a contract over a decoded body. */
export function parseShape<T>(url: string, check: Check<T>, value: unknown): T {
  return check(value, '', url);
}
