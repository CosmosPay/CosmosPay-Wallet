# Chrome Web Store — Submission copy (copy & paste)

Everything below is ready to paste into the Chrome Web Store Developer Dashboard fields.
(Also valid for Edge Add-ons / Firefox AMO with minor tweaks.)

---

## Item name (max 75 chars)

```
Cosmos Pay — Stellar Wallet
```

## Summary / Short description (max 132 chars)

```
Non-custodial Stellar wallet: send, receive & swap XLM and assets. Your keys never leave your device.
```

**Español:**
```
Wallet no custodial de Stellar: envía, recibe e intercambia XLM y activos. Tus claves nunca salen de tu dispositivo.
```

## Detailed description

```
Cosmos Pay is a non-custodial wallet for the Stellar network. Your keys are generated and encrypted on your device — the recovery phrase and secret key never leave it, and servers only ever receive transactions that were signed locally.

FEATURES
• Create a wallet with a 12-word recovery phrase (BIP-39 + SEP-5 derivation, compatible with other Stellar wallets), or import from a phrase or secret key.
• Balances, send & receive XLM and Stellar assets, with a scannable QR for your address.
• Swap assets with automatic quotes and slippage protection.
• Fiat deposits and withdrawals via a KYC-verified account (adults 18+ only).
• Activity history, market prices, and favorite assets pinned to the top.
• Multiple wallets under a single password, 5 languages (EN/ES/PT/DE/FR), light & dark themes.
• Use it as a toolbar popup or pin it to the side panel — your preference is remembered.
• Dapp integration: websites can request your public address, transaction signatures and SEP-7 payments through the injected provider (window.cosmosWallet). Every request opens an approval window where YOU review and confirm — nothing is signed without your password.
• Type "pay" in the address bar followed by a web+stellar: link to pay directly.

SECURITY
Your recovery phrase and secret key are sealed with AES-256-GCM, using a key derived from your password via PBKDF2 (210,000 iterations). Unlocking decrypts them in memory only. A forgotten password can only be resolved by restoring the wallet from its recovery phrase.

NETWORKS
Stellar Testnet (free test XLM via Friendbot) and Mainnet, plus custom networks with your own Horizon server.

Cosmos Pay is open infrastructure for payments on Stellar. Always keep your recovery phrase safe and offline.
```

## Category

```
Productivity  (alternatively: Tools)
```

## Language

```
English  — add ES / PT / DE / FR store translations from the localized summaries above; the extension UI auto-detects all five.
```

---

## Single purpose description

```
Cosmos Pay is a non-custodial cryptocurrency wallet for the Stellar network: it stores the user's encrypted keys locally and lets them send, receive, swap and approve Stellar transactions.
```

## Permission justifications

**storage**
```
Persists the user's public wallet preferences and the read-only "mirror" (public address, selected network, approved dapp origins) that the background service worker needs to answer read-only dapp queries. No secrets are stored here.
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
Injects the window.cosmosWallet provider so any Stellar dapp can request the user's public address, a transaction signature or a SEP-7 payment. The content script is a message bridge only: every request is routed to an extension-owned approval window where the user explicitly reviews and confirms. It never reads or modifies page content.
```

**Host permissions (horizon.stellar.org, horizon-testnet.stellar.org, friendbot.stellar.org, api.coingecko.com, cosmospay.lat and subdomains)**
```
horizon.stellar.org / horizon-testnet.stellar.org: read balances and submit locally-signed Stellar transactions.
friendbot.stellar.org: fund test accounts on Stellar Testnet.
api.coingecko.com: fetch market prices for portfolio valuation.
cosmospay.lat (+subdomains): Cosmos Pay backend for swaps, fiat on/off-ramp (KYC) and account provisioning.
```

**Remote code**
```
No remote code is executed. All JavaScript ships inside the package; network requests exchange JSON data only.
```

## Data usage disclosures (Privacy tab)

- Collects: **email address** (only if the user opts into Cosmos Pay account linking — sent to the Cosmos Pay backend to create/link their account), **financial information** (public Stellar addresses and transaction data submitted to the public Stellar network at the user's request).
- Optional, off by default: anonymous usage metrics and promotional emails (explicit opt-in checkboxes at signup).
- Does NOT collect: browsing history, page content, location, or any credentials. Private keys never leave the device.
- Data is not sold nor transferred to third parties except as required to operate the service (Stellar network, price feed, Cosmos Pay backend).

## Extra fields

**Homepage URL**
```
https://cosmospay.lat
```

**Support / Terms URL**
```
https://dev.cosmospay.lat/tos
```
(Terms live there — EN/ES, covering the gateway and the wallet. Publish a dedicated privacy-policy URL as well before submitting; the Store requires one for extensions that handle user data. Section 8 of the ToS can seed it.)

---

## Assets checklist (not text — prepare before submit)

- [ ] Icon 128×128 (already in package: `icons/icon-128.png`, transparent corners)
- [ ] Screenshots 1280×800 or 640×400 (popup: home, send, swap; side panel; approval window)
- [ ] Optional promo tile 440×280
- [ ] ZIP: contents of `extension/` (not the folder itself)
