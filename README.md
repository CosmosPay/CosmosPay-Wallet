# Cosmos Pay · Non-custodial Stellar Wallet

**English** · [Español](readmes/README.es.md) · [Português](readmes/README.pt.md) · [Deutsch](readmes/README.de.md) · [Français](readmes/README.fr.md)

A **non-custodial** wallet for the **Stellar** network, built with **Astro + Vite + React (TSX)**.
Ships as a **browser extension** (MV3 · Chrome / Edge / Firefox — popup **and** side panel), a
**desktop app** (Tauri · Windows / macOS / Linux), a **mobile app** (Tauri · Android / iOS) and a
web app. Animated **glassmorphism** UI, light &
dark themes, **5 languages** (EN/ES/PT/DE/FR, auto-detected), multi-wallet under one password,
and a dapp provider (`window.cosmosWallet`) so websites can request payments and signatures.

> **Truly non-custodial:** keys are generated and encrypted on your device. Neither the recovery
> phrase nor the secret key ever leaves it. Servers only receive locally-signed transactions.

## Features

| Feature | Detail |
|---|---|
| Create / import / export wallet | 12-word BIP-39 + **SEP-5** derivation (`m/44'/148'/0'`); import from phrase or secret key (`S…`) |
| Encrypted vault | **AES-256-GCM**, key derived with **PBKDF2** (210k iters); unlock decrypts in memory only |
| Idle auto-lock | The session is dropped after 5 minutes without interaction; getting back in needs the password |
| Signing guard | `assertSafeToSign` decodes every XDR before the key touches it and refuses what does not fit the flow (see Security model) |
| Balances, send & receive | Horizon; QR receive; XLM send creates the destination account when needed |
| Swap | Via the Cosmos Pay gateway (auto-quotes, slippage protection) |
| Fiat on/off-ramp | BlindPay receiver (KYC) — deposits & withdrawals, **18+ only** |
| History | Last operations with color-coded icons (green in / red out / white neutral) + genesis marker |
| Favorites & markets | Star assets to pin them in the top-5; live prices (CoinGecko) with animated tickers |
| Multi-wallet | Create / import / switch under one password; per-wallet email, gender-aware greetings |
| Dapp provider | `window.cosmosWallet` (SEP-43-style): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| SEP-7 links | `web+stellar:pay` via provider, Firefox protocol handler, `pay` omnibox keyword and address-bar detection |
| Extension surfaces | Popup (400×600) and side panel / sidebar, with a persistent preference toggle |
| Developer mode | Live-overridable endpoints (prices API, Developer Platform, payments gateway) from Settings |

Key derivation is verified against the official **SEP-5 test vector**.

## Security model

1. On create/import you choose a **password**; an AES key is derived with `PBKDF2(password, salt, 210 000, SHA-256)`.
2. Phrase + secret key are sealed with `AES-256-GCM` (random IV) and stored encrypted
   (`tauri-plugin-store` on desktop and mobile, `localStorage` on web/extension — see
   [src/lib/storage.ts](src/lib/storage.ts) for why a WebView's own storage is not good enough
   to hold a vault).
3. Unlocking decrypts **in memory only**; a wrong password fails the GCM auth tag and is rejected.
4. Signing actions can require the password again (toggle in Settings). The dapp approval window
   signs locally — no secret ever reaches a page or server.
5. **Idle auto-lock:** an open session holds the decrypted key, so 5 minutes without interaction
   drops it and the password is required again.
6. **Nothing is signed that has not been decoded first.** Everything the wallet signs but did not
   build itself — the envelope the gateway returns, the one a dapp hands over — goes through
   `assertSafeToSign` (`src/lib/txGuard.ts`): it decodes the XDR, checks the source is us,
   allowlists only the operations that flow may contain, refuses account-takeover operations
   (`setOptions`, `accountMerge`, sponsorship, clawback), caps the fee, rejects fee-bump wrappers,
   and bounds the amount by the quote the user just confirmed. Refuse, don't warn.
7. The **network passphrase is never taken from the counterparty** — it is read from the wallet's
   own network config, so a "Testnet" approval cannot yield a valid Mainnet signature.
   `signMessage` signs a domain-separated digest, never the caller's bytes, so a 32-byte "message"
   that is really a transaction hash cannot come back as a valid transaction signature.

> The password is **unrecoverable**. If forgotten, remove that wallet from the device and
> restore it with its recovery phrase (other wallets on the device are not affected).

## Stack

**Astro 7** + **Vite** · **React 19 (TSX)** · **@stellar/stellar-sdk** · **bip39** +
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Tauri 2** (desktop + mobile,
Rust) · `node:test` (unit) · Playwright (e2e).

## Development

Requires **Node ≥ 22.12** — Astro 7's own engine floor, and the build/test scripts additionally use
`--experimental-strip-types` (Node 22.6+). CI runs on Node 22.

```bash
npm install
npm run dev          # http://localhost:4500 (Vite proxy: /api + /cosmos-api)
npm run desktop:dev  # the same app in a native window (see Desktop)
npm run android:dev  # ...and on an attached phone (see Mobile)
npm run build        # dist/web/
npm run test:unit    # node:test, no dependencies (see Checks below)
npm run test:e2e     # Playwright e2e (see tests/)
npm run demo         # dapp demo for the provider (http://127.0.0.1:4399)
```

## Browser extension (MV3)

```bash
npm run build:ext            # -> dist/extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> dist/extension-firefox/  (Firefox: sidebar + web+stellar handler)
```

All build output lands under `dist/` (web in `dist/web/`, extensions in `dist/extension[-firefox]/`, release zips in `dist/release/`) so builds never clutter the source root.

- **Chrome / Edge:** `chrome://extensions` → Developer mode → *Load unpacked* → `dist/extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/extension-firefox/manifest.json`.

Architecture: the popup/side panel run the full app; a content script injects
`window.cosmosWallet` into pages; requests travel over a runtime Port to the service worker,
which opens the **approval window** (`approve/`) where the user unlocks and signs locally.
Inline scripts are externalised at build time to satisfy `script-src 'self'`; the manifest is
localized (`_locales/`, EN/ES/PT/DE/FR). Store submission copy lives in
[STORE_LISTING.md](STORE_LISTING.md).

## Desktop (Tauri)

```bash
npm run desktop:dev     # native window against the dev server (HMR + the /api proxies)
npm run desktop:build   # installers into src-tauri/target/release/bundle/
npm run desktop:icons   # regenerate src-tauri/icons/ from public/logo-white.png
```

Needs a **Rust toolchain** (1.77.2+) and each platform's WebView: WebView2 on Windows (present on
Windows 11), WebKitGTK 4.1 + libsoup3 on Linux, nothing extra on macOS. `desktop:build` produces an
NSIS installer and an MSI on Windows, a `.dmg` on macOS, and an AppImage + `.deb` + `.rpm` on Linux.

The Rust side is deliberately small — [src-tauri/src/lib.rs](src-tauri/src/lib.rs) is a plugin list
and nothing else. There is no filesystem, shell, http or process plugin: the frontend holds
decrypted key material, so every command registered there is something an XSS in the bundle could
also call. What is registered, and why, is documented in that file.

Two things a WebView gets wrong are handled explicitly. `crypto.subtle` needs a **secure context**,
which is why the app is served from Tauri's own scheme rather than `file://` — the vault would
simply not decrypt there. And `target="_blank"` has nowhere to open in a window with no browser
chrome, so on some engines it navigates the wallet **in place**, replacing the document that holds
the session; every outbound link goes through
[src/ui/ExternalLink.tsx](src/ui/ExternalLink.tsx) instead.

### Desktop layout

Past `--desk-min` (1024px) the phone column becomes a **window**: a bounded card with a navigation
rail down its left edge and the screen column centred beside it. Nothing about the forty screens
changes — they still render into a column of roughly phone width, because that is what they were
designed for. What changes is the chrome around it.

Which navigation is visible is decided **in CSS**. Both [src/app/DesktopNav.tsx](src/app/DesktopNav.tsx)
and [src/app/BottomNav.tsx](src/app/BottomNav.tsx) go into the DOM and a media query hides one, so
there is no resize listener in the app and nothing that can disagree with itself. The rail is tied
to the **session** rather than the viewport: a 252px rail that came and went on every navigation
would reflow the whole window, where the bottom bar it replaces only ever floated over the content.

This is the web build too — a browser tab at 1400px is a desktop window, Tauri or not. The extension
is excluded by a class rather than by width, because a Chrome side panel can be dragged past 1024px
and must stay a single column with its own drawer.

`npm run test:responsive` walks 320px → 1920px asserting nothing overflows, and probes one pixel
either side of `--desk-min` — the token and the two media-query literals have nothing else keeping
them in step. The rail itself is asserted at the end of `npm run test:e2e`, which is signed in by
then.

## Mobile (Tauri)

```bash
npm run android:init    # once per clone — generates src-tauri/gen/android, then restores the art
npm run android:dev     # build, install and launch on the attached device
npm run android:build   # release APK / AAB
```

`ios:init` / `ios:dev` / `ios:build` are the same three on macOS. Android needs Android Studio's SDK
(**Android 36** + platform-tools), a JDK 17+ and the NDK; iOS needs Xcode. Both need the Rust
targets — `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android
x86_64-linux-android` and `aarch64-apple-ios aarch64-apple-ios-sim`.

### The wallet's own native plugin

Biometric unlock and the share sheet are **[src-tauri/plugins/cosmos](src-tauri/plugins/cosmos)**,
written for this wallet rather than taken off the shelf. That is not preference: the contract
[src/lib/deviceAuth.ts](src/lib/deviceAuth.ts) needs is a key whose every read **is** a live
biometric check — not a check followed by a read — and it needs the key destroyed when the biometric
set changes. The plugin it replaced could write that binding but not read it back, so the flag had
to stay off.

Owning both halves is what makes it possible: Android mints the key with
`setUserAuthenticationRequired(true)`, a per-**use** authentication policy,
`setUnlockedDeviceRequired(true)` and `setInvalidatedByBiometricEnrollment(true)`, and opens it
through a `BiometricPrompt` `CryptoObject`; iOS stores it `.biometryCurrentSet` under
`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`, where `SecItemCopyMatching` raises the sheet
itself. Neither has a code path that reads the key without a prompt.

One vocabulary spans four languages (TypeScript, Rust, Kotlin, Swift) and nothing in any toolchain
checks that the four lists agree — rename a variant and everything still compiles, while a dismissed
prompt starts arriving as a red error line. `tests/unit/nativeContract.test.ts` reads the four files
and compares them.

**Migration note.** An enrolment made before this plugin existed lives in a secure-store namespace
it does not look at, so every phone that had biometric unlock lands on "not enrolled" once, and
re-enables it in Settings. The password works throughout. Refusing rather than migrating is
deliberate — see `DeviceAuthBinding` in [src/lib/deviceAuth.ts](src/lib/deviceAuth.ts).

### Launcher icon and splash

`src-tauri/gen/` is a Tauri **output**: `tauri android init` rewrites it from its own templates, so
anything edited straight into it survives until the next init and then disappears. The real assets
live in the committed `resources/android/`, and
[scripts/android-res.ts](scripts/android-res.ts) copies them back in — which is what
`npm run android:init` runs after the generator.

```bash
npm run android:icons   # regenerate resources/android/ from public/logo-white.png
```

[scripts/android-icons.ts](scripts/android-icons.ts) draws the white mark on `#080808` — the same
`--bg` the app opens onto. It emits the adaptive pair (108dp, inset to the 72dp the launcher
guarantees), **opaque** flat icons for API < 26 and for previews that fall back to them, a circular
`ic_launcher_round`, and the splash ladder. A white-on-transparent flat icon is invisible against a
light surface, and that is what "the icon did not get set" looks like. The desktop set is separate
and comes from [scripts/desktop-icon.ts](scripts/desktop-icon.ts) plus `tauri icon`, for the same
reason: an opaque master, because no desktop launcher insets the art before drawing it.

### Permissions

Same problem as the launcher icon, sharper consequences: the generated manifest declares INTERNET
and nothing else, so the camera the QR scanner opens is refused *without a prompt* — Android denies
a runtime request for a permission the manifest never declared. `npm run native:perms`
([scripts/native-permissions.ts](scripts/native-permissions.ts)) puts the declarations back and is a
no-op when they are already there.

| Declaration | Why |
| --- | --- |
| `android.permission.CAMERA` | `getUserMedia` in [src/features/extras/ScanQR.tsx](src/features/extras/ScanQR.tsx). The WebView raises the runtime prompt itself; the manifest is what makes the prompt possible. |
| `android.permission.USE_BIOMETRIC` | `BiometricPrompt` refuses to show without it. Also declared by the plugin's own manifest — the merger deduplicates, so neither declaration is load-bearing alone. |
| `uses-feature camera`, `camera.autofocus`, `fingerprint`, `required="false"` | Play reads those permissions as *requiring* the hardware and hides the listing from devices without it. Both features have fallbacks, so neither is required. |
| `<queries>` ACTION_IMAGE_CAPTURE | Package visibility, API 30+. Without it `<input capture>` in the KYC step resolves no camera app and silently becomes a gallery picker. |
| `NSCameraUsageDescription`, `NSFaceIDUsageDescription`, `NSPhotoLibraryUsageDescription` | iOS, when the platform is generated. A missing purpose string there is a crash, not a denial. |

Nothing is granted at build time — the user is still asked, once, on first use. The scanner
classifies a refusal ([src/lib/camera.ts](src/lib/camera.ts)) instead of blaming permissions for
every failure: no camera on the device, one held by another app, and a WebView served over plain
`http` (where `navigator.mediaDevices` does not exist) each say what actually happened.

The same script disables Android Auto Backup, so the encrypted vault never reaches Google Drive, and
prints the iOS half it **cannot** fix: the store file is still iCloud-eligible, and closing that
needs `NSURLIsExcludedFromBackupKey` set on a device nobody here can test on. It says so on every
run rather than guessing.

### Pairing a phone over Wi-Fi

`npm run pair:android` ([scripts/adb-pair.ts](scripts/adb-pair.ts)) prints a QR and waits — no cable,
no USB driver. On the phone, **Settings → Developer options → Wireless debugging**, then either of
its two screens:

| Phone screen | What happens |
| --- | --- |
| *Pair device with QR code* | Scan the code in the terminal. Nothing is typed — the password is inside the QR, and printed next to it only so you can see what was sent. |
| *Pair device with pairing code* | Type `<IP:PORT> <CODE>` at the prompt, straight off that dialog. The code is generated by the phone, so it is the one thing no host can know in advance. |

After pairing, the device is asked for again on a second port — the "IP address & Port" on the
Wireless debugging screen. Discovery supplies it when it works; otherwise the prompt takes it, and a
bare port is enough there since the host is already known.

The QR carries `WIFI:T:ADB;S:<name>;P:<password>;;`, the payload Android Studio emits. Both screens
race, along with the USB cable — whichever gives adb a device first wins.

**The QR route only works if inbound mDNS does.** Scanning tells the phone who to trust, not the PC
where the phone is: its port arrives in an `_adb-tls-pairing._tcp` announcement or not at all. The
typed route needs no discovery in either phase, because `adb pair` and `adb connect` dial *out*. That
is why the prompt is there from the first second rather than after a phone is detected.

On Windows, adb's own firewall rule is routinely scoped to the **Public** profile while the network in
use is **Private**, and discovery then fails silently — from the terminal it looks identical to a QR
nobody scanned. The script says so after 20 seconds without a single announcement. To fix it, in an
**admin** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "adb (Private)" -Direction Inbound -Action Allow -Profile Private `
  -Program "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

## Networks

**Testnet** (default — free XLM via Friendbot) ⇄ **Mainnet** from the circular network selector
in the header; custom networks (own Horizon + passphrase) can be added. The same phrase derives
the same account on every network. New Mainnet accounts need ≥ **1 XLM** (base reserve).

## Layout

The tree is organised **by feature**, not by abstraction level. Everything a user-facing
area needs sits in one folder, so working on the fiat flow means opening one directory
instead of three.

```
src/
  pages/          Astro entries: index (app) · approve (dapp approval window)
  app/            the shells and their chrome — WalletApp, ApprovePopup, Shell,
                  BottomNav, NavMenu, Toast, ConfirmSign
  ui/             presentational primitives shared by MORE THAN ONE feature —
                  Field, KVRow, BackBar, Spinner, Logo, TokenAvatar, LangSelect…
  features/       one folder per user-facing area; its screens and the components
                  only it uses live side by side
                  onboarding · wallet · money · liquidity · fiat · cosmospay ·
                  settings · extras
  state/          the store hook and its slices (useToast, usePreferences,
                  useSigningGate)
  hooks/          React hooks shared across features
  lib/            behaviour with no React in it — crypto, vault, stellar, cosmospay,
                  txGuard, validation, amount/memo/asset rules
  constants/      data only: no functions, no runtime imports from lib/
  styles/         mirrors all of the above, file for file
extension-src/    inpage.js (provider) · content.js (bridge) · sw.js (router)
scripts/          build-extension.ts (chrome|firefox) · serve-dist · serve-demo
tests/            unit/ (node:test) · wallet.e2e.ts · responsive.e2e.ts
demo/             dapp-demo.html · pay.html (web+stellar bridge page)
```

### Conventions

These are enforced by review, and the important ones are spelled out with their
rationale in [CLAUDE.md](CLAUDE.md).

| | |
| --- | --- |
| **Imports** | Always `@/…` (→ `src/`). Relative `./` and `../` are banned inside `src/` — they broke silently on file moves and read differently at every depth. |
| **File names** | `PascalCase` when the file's main export is a component, `camelCase` otherwise — regardless of extension (`navModel.tsx` is a module, not a component). Stylesheets are `kebab-case.css`. |
| **Where a file goes** | Used by one feature → that feature's folder; start there. Promote to `ui/` when a *second* feature actually imports it, not before. Holds React state but no markup → `hooks/`. No React at all → `lib/`. |
| **Styles** | No inline `style` attribute, anywhere. `src/styles/` mirrors the source tree: `features/money/Send.tsx` → `styles/features/money/send.css`. A feature may import its own sheet plus anything in `styles/ui/`, never another feature's. |
| **Barrels** | None. They created two ways to import the same symbol; the tree is shallow enough without them. |
| **Layering** | `lib/` and `constants/` never import from `state/`, `features/`, `ui/` or `app/`. Pass the data (`AccountState`), not the container (`WalletStore`). |

### Checks

```bash
npm run check           # astro check — TypeScript + Astro diagnostics, must be 0 errors
npm run test:unit       # node:test, no dependencies: crypto, SEP-5, amounts, memos, asset
                        # identity, the signing guard, API contracts, i18n coverage, and the
                        # native plugin's vocabulary across TypeScript/Rust/Kotlin/Swift
npm run test:e2e        # Playwright: onboarding → vault → unlock → desktop rail
                        # (needs `npm run serve:dist`)
npm run test:responsive # column integrity 320px → 1920px, and the desktop breakpoint

cargo check --manifest-path src-tauri/Cargo.toml   # the Rust half
```

## Disclaimer

Audit the code and test thoroughly on **Testnet** before handling real funds on Mainnet.
Always keep your recovery phrase offline. Fiat features require being of legal age (18+).
