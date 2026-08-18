# Testing

This repo has three layers of tests:

```bash
npm run test:unit      # fast node:test suite over the pure modules (no browser, no deps)
npm run check          # astro check (TypeScript typecheck)
npm run test:e2e       # Playwright smoke test of the full onboarding/unlock flow (needs a server)
npm run test:responsive# Playwright layout test across viewports (needs a server)
```

CI runs `test:unit` first, then `check` (typecheck), then the build, then the
browser tests against the built site — so a money-path or type regression fails
fast, before anything ships.

## Unit tests (`tests/unit/`, `node:test`)

Zero extra dependencies — Node 22's built-in `node:test` runner, `node:crypto`
(`crypto.subtle` for the vault), `fetch`, `Buffer` and `btoa`/`atob`. TypeScript
is executed via `--experimental-strip-types` (same mechanism as the e2e scripts).
Two small bootstrap files make the app's modules importable:

- `tests/setup.mjs` — preload that registers the alias resolver and installs a
  Map-backed `localStorage` stub (`lib/storage.ts` + `lib/endpoints.ts` read it
  at module scope).
- `tests/alias-hook.mjs` — resolves the `@/…` alias (`@/lib/memo` →
  `src/lib/memo.ts`) exactly like the bundler does.

### What is covered

| File | Module under test |
| --- | --- |
| `amount.test.ts` | `src/lib/amount` — the shared decimal parser and exact minor-unit conversion |
| `asset.test.ts` | `src/lib/asset` — asset identity and code ambiguity |
| `memo.test.ts` | `src/lib/memo` — memo kinds and clamping |
| `validate.test.ts` | `src/lib/validate` — endpoint + input rules (email, Horizon URLs) |
| `txGuard.test.ts` | `src/lib/txGuard` — the pre-signature guard, against real XDR |
| `crypto.test.ts` | `src/lib/crypto` — AES-GCM/PBKDF2 seal/open + message-signing domain separation |
| `sep7.test.ts` | `src/lib/sep7` — `web+stellar:pay` URI parsing |
| `portfolio.test.ts` | `src/lib/portfolio` — balance→USD totals, sorting, stablecoin parity |
| `apiShape.test.ts` | `src/lib/apiShape` / `src/lib/cosmospayShapes` — response-contract tolerance |
| `screens.test.ts` | `src/lib/screens` — the navigation table |
| `query.test.ts` | `src/lib/query` — the keyed read cache |
| `exclusive.test.ts` | `src/lib/exclusive` — one-at-a-time execution for money flows |
| `i18n.test.ts` | `src/lib/i18n` — every key translated in all five languages, `t()` fallback |
| `paths.test.ts` | cited `src/…` paths in prose must exist (case-sensitive) |
| `pairInput.test.ts` | `scripts/pairInput` — the typed pairing route |
| `adbMdns.test.ts` | `scripts/adbMdns` — adb service-list parsing |
| `version.test.ts` | the version the app shows is the version the app is |

### Coverage gaps (explicit)

These are **not** unit-tested, and are not claimed to be:

- **The store hook (`src/state/store.ts`)** — a React hook; its effects, async
  actions and the signing-confirmation gate are only exercised through the
  Playwright e2e. The money *decisions* and validation it calls are pure and
  tested, but the hook wiring itself is not.
- **The signing guard** — `requestSignature` (password prompt before signing)
  lives in the store hook and is not unit-tested. Its behavior is covered
  end-to-end by the e2e wrong-password check; the pre-sign transaction checks
  it calls are tested in `txGuard.test.ts`.
- **The dapp approval window (`src/app/ApprovePopup.tsx`)** — depends on
  `chrome.*` and is only exercised in the built browser extension; no automated
  coverage.
- **`.tsx` screens** — JSX can't run under `--experimental-strip-types`, so
  screens are covered only via the browser tests. This is why the validation
  rules live in pure `lib/` modules: the rules are tested, the shells are not.
- **Custom networks, QR scanning, native Capacitor storage** — no unit tests
  (platform-dependent).

## Browser tests (`tests/*.e2e.ts`)

`wallet.e2e.ts` drives the real wallet in Chromium: SEP-5 derivation against the
official test vector, AES-GCM vault sealing, persistence across reload,
decrypt-on-unlock and wrong-password rejection. It asserts on **Spanish** UI
copy (`Crear una wallet nueva`, `Mínimo 8 caracteres`, `Desbloquear`), so an
i18n rename still breaks it — `tests/unit/i18n.test.ts` is the backstop for that.

```bash
npm run build && npm run serve:dist   # terminal 1
E2E_URL=http://127.0.0.1:4321 npm run test:e2e   # terminal 2
```

## Linting

There is no linter in this repo (no ESLint, Biome or knip config). The
`eslint-disable-next-line` comments that previously sat in `src/` disabled a
checker that never ran, so they were removed rather than kept as dead weight.
If linting is adopted later, wire it into CI before `npm run check`.
