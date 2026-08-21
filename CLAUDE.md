# CosmosPay Wallet — working agreement

## Styling: no inline styles, ever

**The `style` attribute is banned in every `.tsx` and `.astro` file.** All styling
lives in `.css` files under `src/styles/`. There are no exceptions — not for
state-driven values, not for per-item computed values, not for CSS custom
properties, not for a one-line tweak.

Components must not accept or forward a `style` prop either. Expose `className`
and let the caller compose a class.

```tsx
// NO
<div className="home-asset-row" style={{ animationDelay: `${i * 0.05}s` }} />
<button style={on ? { background: 'var(--surface)' } : undefined} />

// YES
<div className="home-asset-row" />
<button className={cx('network-dd-item', on && 'is-on')} />
```

Compose class names with `cx()` from `src/lib/cx.ts` — it drops falsy parts, so a
base class plus its conditional modifiers reads as one list instead of a ternary
repeating the base on both branches. It is also how a component folds an incoming
`className` in: `cx('btn-primary', className)`.

### Where a rule goes

Neither `.astro` page carries a `<style>` block; both import stylesheets in
cascade order. **`src/styles/` mirrors the source tree exactly** — a component at
`src/features/money/Send.tsx` has its sheet at `src/styles/features/money/send.css`:

- `src/styles/theme.css` — design tokens only (`--bg`, `--glass-bg`, `--danger`, `--frame-max`)
- `src/styles/base.css` — element resets: `html/body`, form controls, scrollbars
- `src/styles/animations.css` — every `@keyframes`, the press/hover rules, the
  `.stagger-*` ladder, and the reduced-motion block (which must stay last)
- `src/styles/app.css` — utility atoms (`.row`, `.col`, `.g8`, `.f1`, `.min0`,
  `.glass`, `.btn-primary`, `.input`, `.spinner`, `.err-line`, `.spacer`, `.desc`)
- `src/styles/ui/<name>.css` — one sheet per shared primitive
- `src/styles/app/<name>.css` — the shells and their chrome
- `src/styles/features/<feature>/<name>.css` — one sheet per feature file
- `src/styles/approve.css` — document chrome for the approval window only

Name a sheet after what it holds. There is no `shared.css`: four files by that name
meant four unrelated things, and none of them said which.

**A feature may import its own sheet and anything under `styles/ui/` — never another
feature's.** That rule is what moved the exchange-card stack out of the money feature:
liquidity was reaching into `styles/features/money/swap.css` for thirteen classes, so
those classes became `styles/ui/exchange-card.css` and both features import it. If two
features need the same rules, the rules belong in `ui/`, not borrowed across.

A sheet should open with a header comment naming the `.tsx` it dresses — about half
do today, and `tests/unit/paths.test.ts` guards the ones that do by checking the path
resolves. Prefer composing the existing atoms over redeclaring metrics: a full-width
pill button is `className="btn-primary"`, not a fresh 54px/999px rule.

### How to express what used to be inline

| Was inline | Now |
| --- | --- |
| `style={{ background: on ? X : 'transparent' }}` | `.is-on` modifier class |
| `style={{ transform: open ? 'rotate(180deg)' : 'none' }}` | `.is-open` modifier class |
| `style={{ flex: 1 }}` | the existing `.f1` atom |
| `style={{ marginBottom: err ? '8px' : '16px' }}` | `.has-err` modifier class |
| `align === 'right' ? { right: 0 } : { left: 0 }` | `.is-right` / `.is-left` |
| per-index `animationDelay` | `staggerClass(index)` — drop the prop (see below) |
| index-driven position | a modifier class the parent sets |
| content-sized `width: Nch` | a fixed width in the sheet |

Staggered list entrances use the fixed ladder in `animations.css`. Call
`staggerClass(index, dense)` from `src/lib/stagger.ts`; it clamps to
`STAGGER_STEPS`, so rows past the cap share the last delay instead of taking a
computed value. `:nth-child()` is deliberately NOT used anywhere — the rows have
non-row siblings (section headers), so positional selectors would miscount. There are
zero `nth-child` rules in `src/styles/`, and an earlier version of this table told you
to reach for one; it does not any more.

```tsx
<div className={`tap home-asset-row ${staggerClass(index)}`} />
```

Sizes and colours that arrive as props follow the same rule: enumerate the
supported values as classes and type the prop to that union, so an unsupported
value is a compile error rather than a silent missing style. `TokenAvatarSize`
and `SpinnerTone` are the worked examples.

Modifier classes are `.is-*` / `.has-*` and are always written alongside the base
class, never alone. When a modifier has to beat a utility (`.glass`'s animation,
`.glass-soft`'s border), use a compound selector — `.glass.confirm-sign-card` —
so it wins regardless of bundle order instead of reaching for `!important`.

### No JS-side style objects

`src/constants/ui.ts` used to export `C`, `CONTROL`, `CONTROL_H` and `inputStyle`
as `CSSProperties` objects to spread into `style`. **Those exports are gone** — the
file still exists and now holds only plain data (two timings). Colours and metrics
belong in CSS: `.glass` / `.glass-soft` / `.glass-bright` / `.input` /
`.btn-primary` are the class equivalents, and `src/styles/theme.css` is the single
source of truth for colour. Do not reintroduce a TS module of style values — a
constant holding a colour string can only ever be consumed inline.

## Writing CSS here

Ship both the prefixed and unprefixed form of a property when Safari still needs
the prefix (`backdrop-filter`, `user-select`); write them out yourself rather than
trusting the bundler to add them. The CSS minifier is pinned to esbuild in
`astro.config.ts` precisely because the default one deletes declarations — see the
comment there before changing `cssMinify` or `cssTarget`.

The app is a phone-shaped column that also runs as an MV3 popup, a side panel, a
Capacitor WebView and a web page, so viewport-relative heights go through
`--shell-h` and the outer margin through the `--gutter` / `--safe-*` tokens in
`src/styles/theme.css`. Never call `env(safe-area-inset-*)` from a component sheet:
the token carries the `0px` fallback calc() needs, and the shell already applies the
insets once — the HORIZONTAL pair on `.shell-root`, because env() measures from the
viewport and would otherwise pad a centered column a notch never reaches, and the
vertical pair on `.shell-content`, so the frame still paints under the status bar.
A screen adds `--gutter` inside that; it does not repeat the insets. `npm run
test:responsive` guards the column across 320px → 1920px.

## `android/` and `ios/` are build outputs

Both are gitignored and regenerated by `npx cap add`, so **anything edited into them
is gone on the next clone** — silently, since nothing fails. Native changes go in a
committed source that a `capacitor:sync:after` script copies or patches back in:
`resources/android/` + `scripts/android-res.ts` for the launcher icons, and
`scripts/native-permissions.ts` for the manifest and `Info.plist`. Both hooks skip
quietly when the platform folder is absent, because a hook that fails there breaks
`cap sync` itself.

A new native capability is three things, and the first one is the one that gets
forgotten: the **declaration** (a `<uses-permission>` row in `native-permissions.ts`,
or a purpose string for iOS — Android denies an undeclared runtime request with no
prompt at all, and iOS crashes on a missing purpose string), the **plugin** in
`dependencies` behind a dynamic import taken only when `Capacitor.isNativePlatform()`,
and a **web fallback**, because the same screen runs in an MV3 popup and a browser tab.

Do not assume a web API exists in a WebView. `navigator.share` and
`navigator.clipboard.read` are both absent on Android, which is why `lib/share.ts`
exists and why the scanner's paste button hides itself rather than failing; `lib/camera.ts`
classifies a `getUserMedia` rejection instead of reporting every one of them as a
permission problem, since three of the five causes no permission would fix.

## Never sign what you have not decoded

The wallet signs envelopes it did not build: the CosmosPay gateway returns one for
every swap, liquidity and off-ramp operation, and a dapp hands one to the approval
window. **Every one of those goes through `assertSafeToSign` in `src/lib/txGuard.ts`
before the key touches it** — it decodes the XDR, checks the source is us, allowlists
the operations that flow may contain, refuses account-takeover operations
(`setOptions`, `accountMerge`, sponsorship, clawback, `invokeHostFunction`), caps the
fee and the operation count, rejects fee-bump wrappers, requires a bounded validity
window, checks **where** the value lands, bounds what leaves by the quote the user
confirmed and what comes back by the quote's floor. Refuse, don't warn. If a new flow
signs something, it gets an entry in `ALLOWED_OPS`, not an exemption.

Five rules the guard is built on — each one is a hole it shipped with:

- **`GuardOptions` is a discriminated union, not an object of optionals.** With
  `maxSend` optional, the guard was only as strict as its weakest caller: liquidity
  passed no bound at all, and the off-ramp chose `undefined` when the quote field was
  missing. A new intent declares the ceilings it requires, so a flow that signs
  without them does not compile.
- **Bounds come from what the USER saw.** The typed amount, the quote the screen
  rendered. Never from the response that carried the XDR — bounding a gateway's
  envelope with the gateway's own numbers checks nothing at all, and that is exactly
  what `swap.sendAmount` / `swap.destEstimated` were doing while a comment three lines
  above promised they were not.

- **It fails closed.** An operation that moves value and cannot be quantified, an
  asset that does not match what was confirmed, an amount that will not parse: all
  refusals. `sentAmountOf` used to return `null` on any of those and the caller read
  `null` as "no limit", so the cases the guard understood least were the ones it
  bounded least.
- **Checks read decoded SDK fields, never `OpReview.rows`.** `rows` is presentation —
  Spanish labels, formatted values. The amount cap once found its number by matching
  a row labelled `'Importe'`; translating that label would have disabled the cap with
  the whole suite green.
- **Every bound is a total, and every asset is `(code, issuer)`.** Stellar allows 100
  operations per transaction, so a per-operation cap was a 100× cap; and `startsWith`
  on a bare code let `USD` validate against `USDC`. `GuardOptions.destinations` has
  no default for the same reason — a new flow must say where its money may land.

A signature also has to stop being valid. The guard requires a bounded window: no
`maxTime` is a refusal, so is an expired one, one further out than fifteen minutes,
and a `minTime` in the future. The counterparty is the one who submits these
envelopes, so an unbounded window is a free option handed to it. `CLOCK_SKEW_S`
applies at both ends, because `Date.now()` on a phone is not NTP-disciplined and a
device running a few minutes fast would otherwise reject every envelope the gateway
ever sent — with a message blaming the server.

Two more that fall out of the same principle:

- **The network passphrase is never taken from the counterparty.** `fromXDR` does not
  verify it — it only decides which network's hash gets signed — so a dapp supplying
  its own is how a "Testnet" approval yields a valid mainnet signature. Parse with the
  wallet's own `NetConfig`; on a mismatch, refuse and say so.
- **`signMessage` signs a digest, never the caller's bytes** (`src/lib/signMessage.ts`).
  A 32-byte "message" that is really a transaction hash would otherwise come back as a
  valid transaction signature.

## Unlocking with the phone, and answering the gate

`src/lib/deviceAuth.ts` seals the app password under a random 32-byte key and puts only that
key in the OS secure store. Four rules, each one a hole it shipped with:

- **The wrapping key is stored bound, or not at all.** Enrolment writes `accessControl`
  `BIOMETRY_ANY` — **one rung** — and otherwise **refuses**. That rung keeps
  `setUserAuthenticationRequired(true)` and a real `CryptoObject`; `NONE`, the rung it used
  to fall to, keeps neither, skips `setUnlockedDeviceRequired` on API 31-34, and on iOS is
  written with no `kSecAttrAccessible` at all, so it rides an encrypted backup onto another
  device. **Do not add a `BIOMETRY_CURRENT_SET` rung**: the plugin's read path hardcodes
  `getOrCreateCredentialKey(server, 0)` and never forwards `accessControl`, so a key written
  that way can never be read back — see the 25 lines on `DeviceAuthBinding` before touching
  it. A phone that cannot bind the key does not get the feature; it keeps its password,
  which works everywhere. There is deliberately no `verifyIdentity()` call in the module: a
  check that is not the same operation as the read is a check the read can skip.
- **A prompt is answered by id, never by position.** `requestSignature` mints an id,
  `confirmReq` carries it, and `resolveConfirm(ok, id)` discards an answer that does not
  match the head of the queue. An OS sheet can stay open for minutes without generating an
  input event, so the idle auto-lock fires underneath it and `cancelPending()` empties the
  queue — after which a late "yes" used to grant whatever request had arrived since.
- **Anything that changes how the wallet opens is `force`-gated.** That is
  `toggleDeviceAuth`, `acceptDeviceAuthOffer`, `changeAppPassword` and `signRawXdr` — the
  last because `reviewTx` checks only the source account, so the human confirmation is the
  only thing standing between a pasted envelope and `setOptions`. The two enrolment paths
  also check the epoch **on both sides of `enableDeviceUnlock`, and undo the enrolment if it
  moved.** Checking only before is what the code did and it guarded nothing: the OS sheet
  lives *inside* that call and the envelope commits *after* it, so the idle auto-lock fires
  under the open sheet and a stranger's finger completes the enrolment — a permanent second
  door that survives every later lock. `changeAppPassword` needs no epoch (both passwords
  are typed, not closed over) but must call `lock()` on a `PasswordChangeCommitError`.
- **Every path that turns a typed string into the seed reserves an attempt first**
  (`src/lib/attempts.ts`). `beginAttempt` counts the guess and checks the ladder as ONE step,
  on one serialised chain, *before* the derivation. Checking first and counting afterwards
  put ~250ms of PBKDF2 between the two, so every attempt launched inside that window saw a
  clean record and the ladder counted rounds instead of guesses. The paths are `unlock`,
  `checkPassword`, `revealBackup` — which returns the mnemonic on a correct guess — and
  `ApprovePopup`, which is the one a dapp can raise and was the one left out.

`changePassword` opens and re-seals every wallet in memory before committing any, drops each
device-lock enrolment **before** the commit and re-creates it after, and the caller then
calls `lock()`. Do not re-order those: an enrolment re-wrapped *after* the vault moves holds
the old password if anything interrupts the pass, and the user meets "wrong password" coming
from their own fingerprint. Do not patch `session.password` instead of locking: a partially
applied change would make the store assert a password true of some wallets and not others.

## Validation lives in `src/lib/`, never in a component

**No `.tsx` file computes validity from a regex or a length literal.** Import a named
predicate. A bare `/re/.test()` or `.length >= N` in a component is a review blocker —
the amount rule was re-derived in five screens and the memo limit in four, and they
disagreed.

| Concern | Module | Notes |
| --- | --- | --- |
| decimals, minor units | `src/lib/amount.ts` | comma **and** dot; `toMinorUnits` does string maths, so `1,50` is 150 cents |
| memos | `src/lib/memo.ts` | 28 **bytes**, not characters; the memo *kind* travels with the value |
| asset identity | `src/lib/asset.ts` | an asset is `(code, issuer)` — a bare code is not an identifier |
| endpoints, email | `src/lib/validate.ts` | custom Horizon must be `https://` (loopback excepted) |
| API responses | `src/lib/apiShape.ts` + `src/lib/cosmospayShapes.ts` | see below |

A screen may still disable its own button, but the store re-checks the same predicate
before acting: a disabled button is a hint, not an enforcement point.

### API responses are contracts, not casts

`postJson`/`getJson` in `src/lib/cosmospay.ts` take a **required** `shape` argument, so
a new endpoint cannot opt out the way `return json as T` always did. Contracts assert
only the fields the wallet acts on — ids it puts back in a URL, amounts it displays or
compares, and `xdr`, which it signs. Unknown keys pass through on purpose: installed
wallets run weeks behind the server, and rejecting a newly-added field would brick a
release for no security gain. If a contract fires in production, loosen that field —
do not delete the check.

## Tests

`npm run test:unit` (`node:test`, no dependencies) covers the pure modules: the vault's
AES-GCM/PBKDF2 crypto, amounts, memos, asset identity, the signing guard, the response
contracts, the screen table, and that every i18n key exists in all five languages. It
runs in CI before the build. `@/…` resolves through `tests/alias-hook.mjs`. SEP-5
derivation is covered end-to-end, not here — see the Known gap below, and do not read
this list as wider than it is.

Keep logic that decides money **out** of the store hook so it stays reachable from
here — the two Playwright suites only cover onboarding, unlock and layout.

Two of the suites guard facts rather than functions, because the failures they catch
are silent ones:

- `tests/unit/paths.test.ts` asserts every `src/…` path cited in a comment, a
  stylesheet header, CLAUDE.md or a README exists on disk. The refactor left 30 sheets
  pointing at deleted `src/components/…` paths and this document sending
  `staggerClass` to a module that was never created.
- `tests/unit/version.test.ts` guards that `APP_VERSION` stays **derived**. It is no longer
  a literal: `astro.config.ts` injects package.json's version as `__APP_VERSION__` (declared
  in `src/env.d.ts`, read once in `src/constants/app.ts`, supplied to `node:test` by
  `tests/setup.mjs`). Pinning two literals with a test could not work here — the release bot
  bumps package.json in a job that runs *after* the suite, so the assertion always saw the
  pre-bump tree, passed, and then failed for whoever pushed next, blocking every release
  until someone hand-edited a constant. It drifted twice before that was noticed. Derive a
  value rather than testing that two copies of it agree.

A path test cannot see a claim that is false about a path that *does* exist. When a
rule here can be checked by a test, prefer writing the test over writing the sentence.

**Known gap:** `src/lib/vault.ts` and `src/lib/wallet.ts` have no unit tests (SEP-5 is
covered end-to-end). `tests/unit/crypto.test.ts` was called `vault.test.ts` and never
imported `@/lib/vault`, which is why "the vault is covered" read as true.

## Navigation is a table, not four switches

`src/lib/screens.ts` is the single source of truth: `SCREEN_IDS` derives the
`Screen` union and `SCREENS` is typed `Record<Screen, ScreenDef>`, so adding an id
without a row — or without a component in `WalletApp`'s `SCREEN_COMPONENTS` — is a
compile error. Neither map has a `default` any more; an unknown screen used to render
`<Home/>` silently.

- **One way back.** `store.goBack()` pops a real navigation stack and falls back to the
  screen's `back` entry. `onBack={store.goBack}` is the only correct handler — do not
  reintroduce `store.go(...)` or `setScreen(...)` in a back button. `goBack()` returns
  `false` when there is nowhere to go, which is how the Android hardware button knows
  to exit. The `store.back(fallback)` shim that kept the old call sites compiling is
  **gone**; there is one back function now.
- **A terminal screen clears the stack** (`terminal: true`), so back from `success`
  cannot walk into the flow that produced it.
- **`lock()` clears the stack too**, along with the `send` draft and any pending
  signature prompt. Dropping only the session left "back" walking straight from the
  unlock screen into a loaded payment form with a live send button.
- **The bottom nav is derived** (`nav: true`), not a second list to keep in sync.

Screens are lazy by default. Only `welcome`, `unlock` and the four tab screens are
statically imported — everything else is `lazy()`, because the MV3 popup parses its
whole bundle on every open. Anything heavy that is not on the path to a balance
(BIP-39 derivation, jsQR, the flag SVGs) is behind a dynamic import too.

## Reads go through the keyed cache

Every read is scoped to `network × account`. `src/lib/dataKeys.ts` names that scope
and `src/lib/query.ts` caches it, with in-flight deduplication, a TTL, and a
generation counter that discards a result whose scope was invalidated mid-flight.

- Components read with `useQueryValue(key)` — they re-render when *that key* changes,
  not when any of the store's 130 fields does.
- After a write, `invalidate(prefix)` — never a manual refetch at the call site.
- **`retry` is only for idempotent GETs.** Never on a swap, payout or anything that
  signs: a retried payout is a duplicate payment.
- Switching network or wallet needs no clearing: the key changes with the scope, so a
  request still in flight for the old one resolves into a key nobody reads.

## Two invariants the money flows depend on

Both live in `lib/`, not in the store hook — the hook is unreachable from
`node:test`, and these are the newest logic in the signing path.

- **One flow at a time** (`src/lib/exclusive.ts`). `busy` cannot enforce it: it is
  React state set *after* the signing gate resolves, so two taps in the same frame
  both read `false`, both queue a prompt, and both go through — the second closure
  still holding the draft the first one reset. `exclusive.run(key, fn)` owns the whole
  claim/release cycle; the hand-written pairs it replaced held the gate's `await`
  outside their `try`, five times over.
- **The session epoch.** The gate resolves *before* the network round trip, so
  cancelling pending prompts is not enough: a flow already past it keeps `session` in
  its closure across an await that easily outlasts the 5-minute auto-lock — waiting on
  a gateway generates no input events. Every flow captures `sessionEpochRef` before
  its first await and calls `guardSession(epoch)` immediately before the key is used.
  `lock()` increments it and clears the exclusive runner.

## The session is not a field

`session` — the decrypted Stellar secret *and* the app password — is deliberately
**not** on the object screens receive. They get `hasSession` and `publicKey`; anything
needing the key goes through a gated action inside the store (`signRawXdr`,
`revealBackup`, `submitSend`, …). Do not re-expose it: 56 components hold that object,
and every new screen would inherit spending authority by default.

## Consolidating components

Merge what is *the same*, not what looks similar. `Field` absorbed three components by
keeping both surfaces as enumerated variants (`tone="glass" | "soft"`), so the merge
changed no pixels. `.fiat-desc` folded into the `.desc` atom because it was
byte-identical; `.ob-desc` did **not**, because it is 14px and that is a real
difference. Averaging away a deliberate difference is how a consolidation pass
silently restyles screens nobody re-checked — and `npm run test:responsive` guards the
column width, not appearance.

`src/app/ApprovePopup.tsx` and `src/styles/app/approve-popup.css` are
**excluded** from all of this. That window loads neither `app.css` nor `theme.css`, so
its literal colours are deliberate; pulling it into shared primitives would blank the
one screen where a blank render means the user approves what they cannot see.

## No Spanish in code. UI copy goes through i18n.

**Every string literal in `src/` and `extension-src/` is English.** Not a preference —
Spanish literals in code shipped a wallet whose guard refused a French user's
transaction in Spanish, and a dapp window that decided retryable-vs-terminal by
comparing an error against `'Contraseña incorrecta.'`.

Three cases, and the difference matters:

- **Anything a user reads is a key**, resolved through `src/lib/i18n.ts` — all five
  languages, no exceptions, including error messages thrown from `lib/`. A screen with
  the store in reach uses `store.t`; anything without one (`ui/` primitives, the error
  boundary, `ApprovePopup`) uses `tNow`, or `makeT(savedLang())` once when it is about
  to resolve a dozen strings.
- **Anything a machine reads is plain English.** The strings `ApprovePopup` hands to
  `respond()` travel to the dapp: that is API surface, and translating it would be a
  breaking change nobody asked for. Same for `ApiShapeError`, whose audience is whoever
  is reading a stack trace.
- **Nothing branches on copy.** `WrongPasswordError` exists so a caller can write
  `e instanceof WrongPasswordError`; `TxGuardError` carries `key` and `params` so a
  test can assert *which* check fired. A comparison against a rendered string is a
  review blocker — it is one translation away from silently inverting.

`src/lib/txGuard.ts` is the worked example: ~80 `guard.*` keys, and
`tests/unit/txGuard.test.ts` asserts refusals by key, so rewording a refusal breaks
nothing and deleting a check breaks a test.

**Not yet done, and known:** ~140 of the 600 i18n keys are still English in the `pt`,
`de` and `fr` columns. `tests/unit/i18n.test.ts` only checks a key is non-empty in
every language, so those pass. It is a real gap in the KYC flow especially, which
defaults to `country='BR'`.

## Where a file goes

**One taxonomy: by feature.** The tree used to run two at once — `atoms/ molecules/
organisms/` (by abstraction level) crossed with `main/ money/ fiat/` (by feature) — so
a fiat component's home was decided by "how big is it", a judgement nobody applies the
same way twice, and touching the fiat flow meant opening three directories.

```
src/
  app/          the shells and their chrome: WalletApp, ApprovePopup, Shell,
                BottomNav, NavMenu, Toast, ConfirmSign, ErrorBoundary
  ui/           presentational primitives used by MORE THAN ONE feature —
                Field, KVRow, BackBar, Spinner, Logo, TokenAvatar…
  features/     one folder per user-facing area; screens and the components only
                that area uses live side by side
    onboarding/ wallet/ money/ liquidity/ fiat/ cosmospay/ settings/ extras/
  state/        the store hook and its slices
  hooks/        React hooks shared across features
  lib/          behaviour with no React in it — crypto, Stellar, parsing, validation
  constants/    data only: no functions, no runtime imports from lib/
  styles/       mirrors all of the above
```

`constants/` may take a **type-only** import from `lib/` — `constants/fiat.ts` types
its rail table with `PayinMethod`, which belongs next to the API client that returns
it, and a `import type` is erased at build. Runtime imports from `lib/`, and *any*
import from `state/ features/ ui/ app/`, stay banned: `constants/assets.ts` used to
type its table with `TokenAvatarTone` from `ui/`, so the union now lives beside the
table and the component imports it the other way round.

The `constants/` rule is also why the screen table is at `src/lib/screens.ts` and not
in `constants/`: it exports `backTarget()` and its rows carry resolver functions, so
by this taxonomy it is behaviour, not data.

Deciding where something goes:

- Used by one feature → that feature's folder. **Start here.** Do not promote to
  `ui/` "because it might be reused"; move it when a second feature actually imports it.
  This is enforced retroactively: `NetworkDropdown`, `SurfaceToggle`, `BackCircle` and
  `StellarMark` were in `ui/` with one importing feature each and now live in
  `features/wallet/`; `NumberPad` had none and was deleted. `Spinner` (28 importers),
  `BackBar` (31) and `Field` (10) earned the place.
  The count that matters is *importing features*, not importers: `EyeIcon` and
  `FlagIcon` stay in `ui/` with one and zero feature importers because their consumers
  are `Field` and `LangSelect` — shared primitives. Moving a primitive's own helper
  into a feature would make `ui/` import from `features/`, which the layering forbids.
- Used by several features and purely presentational → `ui/`.
- Holds React state but no markup → `hooks/`. No React at all → `lib/`.
- A screen is not a special kind of file: it sits in its feature folder next to the
  components it uses. `WalletApp`'s screen table decides what is a screen.

**Naming.** `PascalCase` when the file's main export is a component, `camelCase`
otherwise — *regardless of extension*. `app/navModel.tsx` is `.tsx` because it builds
JSX icons, but it exports a navigation model, not a component, so it stays camelCase.
Stylesheets are `kebab-case.css`.

No barrel files, and no `index.ts` either. The one under `hooks/` was not a barrel —
it held three unrelated hooks — but in a repo that bans barrels the filename is the
claim, and it is the only name that says nothing about what is inside. One file per
hook: `src/hooks/useCopied.ts`, `src/hooks/useBusy.ts`,
`src/hooks/useAnimatedNumber.ts`.

`useQuery` is in `hooks/`, not `lib/`: it calls `useSyncExternalStore`. The cache it
binds to (`lib/query.ts`) is the part that must stay framework-free, and that split is
already what makes it testable.

### Constants live in `constants/`

**A value that is data belongs in `src/constants/`, not next to the code that reads
it.** Limits, thresholds, tunables, lookup tables, storage keys, ladders — if it is a
literal a reviewer might want to find or change, it has a home under `constants/` named
after the area it serves, and the module imports it.

The point is not tidiness. A ceiling buried in the middle of an 800-line guard is a
ceiling nobody audits: `BOUND_TOLERANCE_BPS` sat at `100n` — a standing 1% skim licence
on every swap — under a comment claiming it absorbed 7-decimal rounding, and no reader
ever put those two facts side by side. Collected in one file, the numbers can be read
as a set.

Three carve-outs, because `constants/` is data and stays data:

- **Behaviour is not a constant.** `src/lib/screens.ts` keeps `SCREENS` because its rows
  carry resolver functions and it exports `backTarget()`. `WalletApp`'s
  `SCREEN_COMPONENTS` keeps its place because its values are `lazy()` calls — runtime
  imports of `features/`, which `constants/` may never do.
- **Copy is not a constant either — it is a key.** `constants/` cannot call the
  translator (no runtime import from `lib/`), so a table of user-facing labels holds
  i18n keys and the component resolves them. `APPROVE_TITLE_KEYS` and `OP_LABEL_KEYS`
  are the shape; they used to be Spanish literals in `constants/app.ts`, which put copy
  somewhere it could not be translated.
- **A private sentinel is not a constant.** `NO_ATTEMPTS`, `EMPTY_HISTORY`, the
  `TextEncoder` in `crypto.ts`: single-use implementation details with no reader outside
  their module. Moving those buys nothing and costs an import.

A **type-only** import from `lib/` is fine and often right (`constants/fiat.ts` types its
rail table with `PayinMethod`); `import type` is erased at build. Runtime imports from
`lib/`, and *any* import from `state/ features/ ui/ app/`, stay banned.


## Imports are always `@/`

**Relative imports (`./`, `../`) are banned in `src/`.** Always `@/…`, which resolves
to `src/` (`tsconfig.json` `paths`, `astro.config.ts` `resolve.alias`).

```ts
// NO
import { Spinner } from '../../ui/Spinner';
import { spendableXlm } from './shared';

// YES
import { Spinner } from '@/ui/Spinner';
import { spendableXlm } from '@/lib/balances';
```

Why, concretely: a `./shared` import told you nothing about what it was — two files by
that name held unrelated things, and moving either broke imports silently. `@/` paths
survive a file move untouched, grep to exactly one place, and read the same from every
depth.

## Layering

`lib/` and `constants/` must never import from `state/`, `features/`, `ui/` or `app/`.
That inversion had already happened: `lib/balances.ts` and the fiat formatter took the
whole `WalletStore` to read one field, which made them unreachable from a unit test
without constructing the entire 130-key store. Take the data (`AccountState`,
`TokenBalance[]`), not the container.

## The store is a facade over slices

`src/state/store.ts` composes slices; new state belongs in a slice, not in the hook.
Existing ones: `useToast`, `usePreferences` (theme / language / manual-confirm toggle)
and `useSigningGate` (the password prompt every signing action passes through).

A slice earns its file when its state is cohesive and its dependencies are few — not
when the store simply feels long. `useSigningGate` is the model: small, but it is a
state machine whose correctness matters, and pulling it out is what exposed that two
concurrent gated actions used to overwrite each other's resolver and hang forever.
