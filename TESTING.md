# Testing

This repo has three layers of tests. Run them all with:

```bash
npm run test:unit      # fast node:test suite over the pure modules (no browser, no deps)
npm run check:guards   # repo guards: i18n completeness + cited-path existence
npm run test:e2e       # Playwright smoke test of the full onboarding/unlock flow (needs a server)
npm run test:responsive# Playwright layout test across viewports (needs a server)
```

CI runs `test:unit` and `check:guards` **before** the build so a money-path
regression fails fast, then runs the browser tests against the built site.

## Unit tests (`tests/unit/`, `node:test`)

Zero extra dependencies — Node 22's built-in `node:test` runner, `node:crypto`
(`crypto.subtle` for the vault), `fetch`, `Buffer` and `btoa`/`atob`. TypeScript
is executed via `--experimental-strip-types` (same mechanism as the e2e
scripts). Two small bootstrap files make the app's modules importable:

- `tests/unit/loader.mjs` — a module-loader hook that resolves the `@/…` alias
  (`@/lib/vault` → `src/lib/vault.ts`) exactly like the bundler does.
- `tests/unit/register.mjs` — registers the loader and installs a Map-backed
  `localStorage` stub so the vault/storage modules run outside a browser.

### What is covered

| File | Module under test |
| --- | --- |
| `validation.test.ts` | `src/lib/validation` — every input predicate (amounts, memos, email, password, asset codes, endpoints, link codes) |
| `money.test.ts` | `src/lib/money` — the send/swap/LP-deposit/LP-withdraw/fiat decision functions |
| `crypto.test.ts` | `src/lib/crypto` — AES-GCM/PBKDF2 seal/open, wrong-password rejection, tamper detection |
| `vault.test.ts` | `src/lib/vault` — add/list/unlock/remove/migrate/changePassword + all CosmosPay persistence |
| `stellar.test.ts` | `src/lib/stellar` — amount normalization, network tables, `networkEnv`, explorer URLs |
| `wallet.test.ts` | `src/lib/wallet` — StrKey validity, mnemonic normalize/validate, SEP-5 derivation (official test vector) |
| `sep7.test.ts` | `src/lib/sep7` — `web+stellar:pay` URI build/parse |
| `portfolio.test.ts` | `src/lib/portfolio` — balance→USD total, sorting, stablecoin parity, 24h change |
| `cosmospay.test.ts` | `src/lib/cosmospay` — response-contract tolerance (`extractUnsignedXdr`), network mapping, nonce |
| `i18n.test.ts` | `src/lib/i18n` — locale tags, `makeT` interpolation + fallbacks, language detection |
| `greeting.test.ts` | `src/lib/greeting` — `ageFromBirthdate` (also gates the fiat 18+ rule) |
| `app.test.ts` | `src/constants/app` — the navigation table, splash timing, approval-window titles |

### Coverage gaps (explicit)

These are **not** unit-tested, and are not claimed to be:

- **The store hook (`src/components/store.ts`)** — a React hook; its effects,
  async actions and the signing-confirmation gate (`requestSignature`) are only
  exercised through the Playwright e2e. The money *decisions* it calls are pure
  and tested (`src/lib/money`), but the hook wiring itself is not.
- **The signing guard** — `requestSignature` (password prompt before signing)
  lives in the store hook and is not unit-tested. Its behavior is covered
  end-to-end by the e2e wrong-password check.
- **The dapp approval window (`src/components/ApprovePopup.tsx`)** — depends on
  `chrome.*` and is only exercised in the built browser extension; no automated
  coverage.
- **The price "cache"** — there is no dedicated cache module in this codebase;
  `getPrices()` fetches per call. Nothing to test.
- **`.tsx` screens** — JSX can't run under `--experimental-strip-types`, so
  screens are covered only via the browser tests. This is why the validation
  rules were moved into pure `lib/` modules: the rules are tested, the shells
  are not.
- **Custom networks, QR scanning, native Capacitor storage** — no unit tests
  (platform-dependent).

## Repo guards (`scripts/`, `npm run check:guards`)

- `check-i18n.ts` — every i18n key must exist in **all five** languages
  (es/en/pt/de/fr) and be defined exactly once. Catches a language line dropped
  in a rename — exactly the class of bug that made the old e2e assertions
  brittle.
- `check-paths.ts` — every `src/…` path cited in a comment, stylesheet header or
  doc must actually exist (extensionless citations resolve like the bundler).

## Browser tests (`tests/*.e2e.ts`)

`wallet.e2e.ts` drives the real wallet in Chromium: SEP-5 derivation against the
official test vector, AES-GCM vault sealing, persistence across reload,
decrypt-on-unlock and wrong-password rejection. It asserts on **Spanish** UI
copy (`Crear una wallet nueva`, `Mínimo 8 caracteres`, `Desbloquear`), so an
i18n rename still breaks it — the `check:i18n` guard is the backstop for that.

```bash
npm run build && npm run serve:dist   # terminal 1
E2E_URL=http://127.0.0.1:4321 npm run test:e2e   # terminal 2
```

## Linting

There is no linter in this repo (no ESLint, Biome or knip config). The ~14
`eslint-disable-next-line` comments that previously sat in `src/` disabled a
checker that never ran, so they were removed rather than kept as dead weight.
If linting is adopted later, wire it into CI before `npm run check`.
