# Cosmos Pay · Non-custodial Stellar Wallet

**English** · [Español](readmes/README.es.md) · [Português](readmes/README.pt.md) · [Deutsch](readmes/README.de.md) · [Français](readmes/README.fr.md)

A **non-custodial** wallet for the **Stellar** network, built with **Astro + Vite + React (TSX)**.
Ships as a **browser extension** (MV3 · Chrome / Edge / Firefox — popup **and** side panel), a
**mobile app** (Capacitor · Android / iOS) and a web app. Animated **glassmorphism** UI, light &
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
   (`@capacitor/preferences` on mobile, `localStorage` on web/extension).
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
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Capacitor 8** · `node:test` (unit)
· Playwright (e2e).

## Development

Requires **Node ≥ 22.12** — Astro 7's own engine floor, and the build/test scripts additionally use
`--experimental-strip-types` (Node 22.6+). CI runs on Node 22.

```bash
npm install
npm run dev          # http://localhost:4500 (Vite proxy: /api + /cosmos-api)
npm run dev:android  # same dev server, live-reloading inside the phone (see Mobile)
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

## Mobile (Capacitor)

```bash
npx cap add android   # once per clone — /android is generated, never committed | npx cap add ios (macOS)
npm run cap:android   # ship build: astro build + sync + open Android Studio    | npm run cap:ios
npm run dev:android   # dev build: live reload on the device                    | npm run dev:ios
```

Android needs Android Studio's SDK (**Android 36** + platform-tools) and a JDK 17+; iOS needs macOS
with Xcode. `dev:android` finds the SDK at its default install path when `ANDROID_HOME` is unset —
Android Studio does not export it — so there is nothing to add to your environment.

### Launcher icon and splash

`android/` is generated, so anything written into it is gone on the next clone — which is why the
app used to ship Capacitor's placeholder logo. The real assets live in the committed
`resources/android/`, and [scripts/android-res.ts](scripts/android-res.ts) copies them back in from
the `capacitor:sync:after` hook, i.e. on every `cap add`, `cap sync` and `cap run`.

```bash
npm run android:icons   # regenerate resources/android/ from public/logo-white.png
```

[scripts/android-icons.ts](scripts/android-icons.ts) draws the white mark on `#080808` — the same
`--bg` the app opens onto. It emits the adaptive pair (108dp, inset to the 72dp the launcher
guarantees), **opaque** flat icons for API < 26 and for previews that fall back to them, a circular
`ic_launcher_round`, and the splash ladder. A white-on-transparent flat icon is invisible against a
light surface, and that is what "the icon did not get set" looks like.

`@capacitor/android` and `@capacitor/ios` are **devDependencies**, next to `@capacitor/cli`: they
ship no JavaScript into `dist/web/`, only Gradle and Xcode ever read them. `@capacitor/core` and the
plugins (`app`, `clipboard`, `preferences`) stay in `dependencies` because their JS *is* bundled.

`dev:android` ([scripts/cap-dev.ts](scripts/cap-dev.ts)) starts `astro dev --host`, points the
WebView at `http://<LAN-IP>:4500` via `cap run --live-reload`, and deploys a debug build — so the
phone gets HMR and the `/api` + `/cosmos-api` proxies, not a frozen bundle. Only the *native* copy
of `capacitor.config.json` is rewritten, and Capacitor reverts it on `Ctrl+C`.

`dev:android` builds `dist/web/`, syncs it into the native project, compiles a debug APK and
installs it. **The app then runs entirely off the device** — no dev server, nothing fetched from
your machine. That is how it ships, so it is also the only way to see what it really does.

The cost is that a change means another build and install (a few seconds once Gradle is warm), not a
hot reload. `--live` trades that back for HMR and the `/api` + `/cosmos-api` dev proxies, at the
price of the WebView depending on a server it has to reach.

| Flag | For |
| --- | --- |
| `-- --no-build` | redeploy the bundle already in `dist/web/` |
| `-- --list` | print the attached devices/emulators and quit |
| `-- --target <id>` | pick one when several are connected |
| `-- --no-pair` | fail outright instead of offering the pairing QR below |
| `-- --live` | live reload off the dev server, through adb |
| `-- --live --lan` | live reload over the LAN instead (`--host <ip>` pins the address) |

Under `--live --lan` on Windows, expect the firewall: `node.exe`'s inbound rules are written for the
**Public** profile while a home network is **Private**, so nothing on the LAN reaches port 4500 and
the WebView shows Capacitor's `backgroundColor` — a black screen with no error anywhere. Plain
`--live` tunnels over adb and avoids the question; allowing the direct route needs an admin
PowerShell:

```powershell
New-NetFirewallRule -DisplayName "node dev server (Private)" -Direction Inbound -Action Allow `
  -Profile Private -Program "C:\Program Files\nodejs\node.exe"
```

`cap run android` is not used: it shells out to `./gradlew`, which cmd.exe cannot execute, and there
is no flag for it. [scripts/cap-dev.ts](scripts/cap-dev.ts) runs the same three steps itself — `cap
sync`, the Gradle wrapper, then `native-run` to install and launch.

### Pairing a phone over Wi-Fi

With no device attached, `dev:android` prints a QR and waits — no cable, no USB driver.
`npm run pair:android` ([scripts/adb-pair.ts](scripts/adb-pair.ts)) does the same on its own. On the
phone, **Settings → Developer options → Wireless debugging**, then either of its two screens:

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
npm run test:unit       # node:test, no dependencies: crypto, SEP-5, amounts, memos,
                        # asset identity, the signing guard, API contracts, i18n coverage
npm run test:e2e        # Playwright: onboarding → vault → unlock (needs `npm run serve:dist`)
npm run test:responsive # column integrity 320px → 1920px
```

## Disclaimer

Audit the code and test thoroughly on **Testnet** before handling real funds on Mainnet.
Always keep your recovery phrase offline. Fiat features require being of legal age (18+).
