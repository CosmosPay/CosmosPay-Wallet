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

> The password is **unrecoverable**. If forgotten, remove that wallet from the device and
> restore it with its recovery phrase (other wallets on the device are not affected).

## Stack

**Astro 7** + **Vite** · **React 19 (TSX)** · **@stellar/stellar-sdk** · **bip39** +
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Capacitor 8** · Playwright (e2e).

## Development

Requires **Node ≥ 18**.

```bash
npm install
npm run dev          # http://localhost:4500 (Vite proxy: /api + /cosmos-api)
npm run build        # dist/
npm run test:e2e     # Playwright e2e (see tests/)
npm run demo         # dapp demo for the provider (http://127.0.0.1:4399)
```

## Browser extension (MV3)

```bash
npm run build:ext            # -> extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> extension-firefox/  (Firefox: sidebar + web+stellar handler)
```

- **Chrome / Edge:** `chrome://extensions` → Developer mode → *Load unpacked* → `extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `extension-firefox/manifest.json`.

Architecture: the popup/side panel run the full app; a content script injects
`window.cosmosWallet` into pages; requests travel over a runtime Port to the service worker,
which opens the **approval window** (`approve/`) where the user unlocks and signs locally.
Inline scripts are externalised at build time to satisfy `script-src 'self'`; the manifest is
localized (`_locales/`, EN/ES/PT/DE/FR). Store submission copy lives in
[STORE_LISTING.md](STORE_LISTING.md).

## Mobile (Capacitor)

```bash
npm run build
npx cap add android   # once (Android Studio)  |  npx cap add ios (macOS + Xcode)
npm run cap:android   # build + sync + open    |  npm run cap:ios
```

## Networks

**Testnet** (default — free XLM via Friendbot) ⇄ **Mainnet** from the circular network selector
in the header; custom networks (own Horizon + passphrase) can be added. The same phrase derives
the same account on every network. New Mainnet accounts need ≥ **1 XLM** (base reserve).

## Layout

```
src/pages/            index (app) · approve (dapp approval) · sidepanel via build
src/components/       WalletApp · store.ts · parts.tsx · screens/ (Onboarding, Unlock, Main,
                      Money, Settings, Extras, Fiat, CosmosPay)
src/lib/              wallet · crypto · vault · storage · stellar · cosmospay · endpoints ·
                      portfolio · greeting · i18n · sep7 · qr · format …
extension-src/        inpage.js (provider) · content.js (bridge) · sw.js (router)
scripts/              build-extension.ts (chrome|firefox) · serve-dist · serve-demo
demo/                 dapp-demo.html · pay.html (web+stellar bridge page)
```

## Disclaimer

Audit the code and test thoroughly on **Testnet** before handling real funds on Mainnet.
Always keep your recovery phrase offline. Fiat features require being of legal age (18+).
