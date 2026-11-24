# Chrome Web Store — Submission copy (copy & paste)

Everything below is ready to paste into the Chrome Web Store Developer Dashboard fields.
(Also valid for Edge Add-ons / Firefox AMO with minor tweaks.)

The name and the short description must match what the package says about itself:
`APP_NAME` and `LOCALES` in `scripts/build-extension.ts` write them into `_locales/`.
Change both places together.

---

## Item name (max 75 chars)

```
Cosmos Pay Wallet
```

## Summary / Short description (max 132 chars)

```
Non-custodial wallet for 30+ networks: send, receive and swap crypto and stablecoins. Your keys are encrypted on your device.
```

**Español:**
```
Wallet no custodial para más de 30 redes: envía, recibe e intercambia cripto y stablecoins. Tus claves se cifran en tu dispositivo.
```

## Detailed description

```
Cosmos Pay Wallet is a non-custodial wallet for more than 30 networks: Ethereum, Base, Arbitrum, BNB Chain, Polygon, Bitcoin, Tron, TON, Sui, Stellar and many more. Your keys are generated and encrypted on your device, and every transaction is signed there.

FEATURES
• One recovery phrase, an address on every network. Create a wallet with a 12-word phrase, or import one from another wallet (phrase or secret key).
• Send and receive on every network the wallet holds, with a scannable QR for each address.
• Swap between networks and tokens with automatic quotes and slippage control.
• Buy and sell crypto with local money.
• Activity, balances by network and asset, and favorites pinned to the top.
• Unlock with a passkey instead of typing a password, on devices that support it.
• Move your wallet to another device with a QR code and a one-time code.
• Several wallets under one password, 5 languages (EN/ES/PT/DE/FR), light and dark themes.
• Use it as a toolbar popup or in the side panel; your choice is remembered.
• Connect to dapps: Stellar dapps through window.cosmosWallet (address, transaction and message signatures, SEP-7 payments), EVM dapps through a standard EIP-1193 / EIP-6963 provider, and any site through WalletConnect. Every request opens an approval window where YOU review and confirm; nothing is signed without your password or passkey.
• Type "pay" in the address bar followed by a web+stellar: link to pay directly.

SECURITY
Your recovery phrase and keys are sealed with AES-256-GCM under a key derived from your password (PBKDF2-SHA256, 600,000 iterations). Unlocking decrypts them in memory only, and the wallet locks itself after the idle time you choose. Transactions are decoded and shown to you before anything is signed. The optional cloud backup is sealed on your device before it is uploaded, and only your own password or passkey opens it.

NETWORKS
Main networks and their test networks, switched with one tap.

Always keep your recovery phrase safe and offline.
```

## Category

```
Productivity  (alternatively: Tools)
```

## Language

```
English  — add ES / PT / DE / FR store translations from the localized summaries above; the extension UI opens in English and offers all five.
```

---

## Single purpose description

```
Cosmos Pay Wallet is a non-custodial cryptocurrency wallet: it stores the user's encrypted keys on the device and lets them send, receive and swap crypto on the networks it supports, and approve the transactions and signatures that websites request.
```

## Permission justifications

**storage**
```
Persists the user's encrypted wallet and preferences, and the read-only "mirror" (public addresses, selected network, sites the user connected) that the background service worker needs to answer read-only requests from websites. Secrets are stored only encrypted.
```

**sidePanel**
```
The wallet can be used as a side panel instead of the action popup; the user toggles this preference in-app and the browser remembers it.
```

**clipboardRead**
```
Lets the QR scanner decode a payment QR image pasted from the clipboard (user-initiated button or Ctrl+V) when the camera is unavailable. Clipboard is only read at that explicit user action; nothing is monitored in the background.
```

**omnibox**
```
Registers the "pay" keyword so users can paste a web+stellar: (SEP-7) payment link in the address bar and open the wallet's approval window directly.
```

**Content scripts on http/https (all sites)**
```
Injects the wallet's providers so any dapp can find it: window.cosmosWallet for Stellar dapps and an EIP-1193 provider (announced with EIP-6963) for EVM dapps. The content script is a message bridge only: every request that reveals an address or needs a signature is routed to an extension-owned approval window where the user explicitly reviews and confirms. It never reads or modifies page content.
```

**Host permissions (public network nodes, price feed, Cosmos Pay backend)**
```
Each supported network's public node or API (for example the publicnode.com RPCs, horizon.stellar.org, mempool.space, api.trongrid.io, toncenter.com): read balances and submit transactions signed on the device. Their test networks: the same, in test mode, plus friendbot.stellar.org to fund test accounts.
api.coingecko.com: market prices for portfolio valuation.
cosmospay.lat (+subdomains): the Cosmos Pay backend for the wallet account and its encrypted backup, swaps, buying and selling with local money, and account recovery.
The full list is generated at build time from the wallet's network registry and printed in manifest.json.
```

**Remote code**
```
No remote code is executed. All JavaScript ships inside the package; network requests exchange JSON data only.
```

## Data usage disclosures (Privacy tab)

- Collects: **personally identifiable information**: the email address, required to create the wallet's Cosmos Pay account during setup (a code is sent to it, and the account links that email to the wallet's public address); legal name, date of birth, tax id, address and identity documents only if the user verifies their identity for bank transfers. **Financial and payment information**: public wallet addresses and the transactions the user submits to public networks; a bank account only if the user registers one for bank transfers.
- Optional, off by default: anonymous usage metrics and promotional emails (explicit opt-in checkboxes at signup). The metrics consent is what enables **diagnostics**: error messages, screen names, request timings and the operations the user runs (asset code and amount, never the destination and never the memo), sent to the Cosmos Pay backend. It can be turned off again at any time in Settings → Privacy. A wallet with no Cosmos Pay account reports anonymously and without any address, amount or transaction hash at all.
- Does NOT collect: browsing history, page content, location, or any credentials. Private keys and the recovery phrase leave the device only inside the encrypted backup, which only the user's own password or passkey opens.
- Data is not sold nor transferred to third parties except as required to operate the service (public networks, price feed, Cosmos Pay backend).

Firefox declares the same thing in the manifest (`DATA_COLLECTION` in `scripts/build-extension.ts`): the email as required, financial information and diagnostics as optional.

## Extra fields

**Homepage URL**
```
https://cosmospay.lat
```

**Support / Terms URL**
```
https://cosmospay.lat/tos
```

**Privacy policy URL**
```
https://cosmospay.lat/tos#privacy
```
(The same two links the Welcome screen shows, `TERMS_URL` and `PRIVACY_URL` in `src/constants/app.ts`: Cosmos Pay's terms, which cover the wallet, and their privacy section. The Store requires a privacy policy for extensions that handle user data, so check before submitting that both answer and that the privacy section describes what the wallet collects, as listed above. wallet.cosmospay.lat has no DNS record: do not list it until its pages are live.)

---

## Assets checklist (not text — prepare before submit)

- [ ] Icon 128×128 (already in package: `icons/icon-128.png`, transparent corners)
- [ ] Screenshots 1280×800 or 640×400 (popup: home, send, swap; side panel; approval window)
- [ ] Optional promo tile 440×280
- [ ] ZIP: the release's `cosmos-pay-chrome-v<version>.zip` (built by CI, brand icons). A zip built on a laptop needs `COSMOS_ICONS=release`, or it ships the amber dev icon.
