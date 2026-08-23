# Cosmos Pay · Nicht-verwahrende Stellar-Wallet

[English](../README.md) · [Español](README.es.md) · [Português](README.pt.md) · **Deutsch** · [Français](README.fr.md)

**Nicht-verwahrende** Wallet für das **Stellar**-Netzwerk, gebaut mit **Astro + Vite + React (TSX)**.
Erhältlich als **Browser-Erweiterung** (MV3 · Chrome / Edge / Firefox — Popup **und** Seitenleiste),
**Mobile App** (Tauri · Android / iOS) und Web. Animiertes **Glassmorphism**-UI, heller und
dunkler Modus, **5 Sprachen** (EN/ES/PT/DE/FR mit Autoerkennung), Multi-Wallet unter einem
Passwort und ein Dapp-Provider (`window.cosmosWallet`) für Zahlungen und Signaturen.

> **Wirklich non-custodial:** Schlüssel werden auf deinem Gerät erzeugt und verschlüsselt. Weder
> die Wiederherstellungsphrase noch der geheime Schlüssel verlassen es. Server erhalten nur
> lokal signierte Transaktionen.

## Funktionen

| Funktion | Detail |
|---|---|
| Wallet erstellen / importieren / exportieren | 12-Wörter-BIP-39 + **SEP-5**-Ableitung (`m/44'/148'/0'`); Import per Phrase oder geheimem Schlüssel (`S…`) |
| Verschlüsselter Tresor | **AES-256-GCM**, Schlüssel via **PBKDF2** (210k Iterationen); Entsperren entschlüsselt nur im Speicher |
| Automatische Sperre | Die Sitzung wird nach 5 Minuten ohne Interaktion verworfen; danach ist das Passwort wieder nötig |
| Signatur-Wächter | `assertSafeToSign` dekodiert jedes XDR vor dem Signieren und lehnt ab, was nicht zum Ablauf passt (siehe Sicherheitsmodell) |
| Guthaben, Senden & Empfangen | Horizon; QR zum Empfangen; XLM-Versand erstellt das Zielkonto bei Bedarf |
| Swap | Über das Cosmos-Pay-Gateway (Auto-Quotes, Slippage-Schutz) |
| Fiat (On/Off-Ramp) | BlindPay-Receiver (KYC) — Ein- und Auszahlungen, **nur 18+** |
| Verlauf | Letzte Vorgänge mit Farbcodes (grün rein / rot raus / weiß neutral) + Genesis-Marker |
| Favoriten & Märkte | Assets anpinnen (Top-5); Live-Preise (CoinGecko) mit animierten Zahlen |
| Multi-Wallet | Erstellen / importieren / wechseln unter einem Passwort; editierbare E-Mail, geschlechtergerechte Begrüßungen |
| Dapp-Provider | `window.cosmosWallet` (SEP-43-Stil): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| SEP-7-Links | `web+stellar:pay` via Provider, Firefox-Protocol-Handler, Omnibox-Keyword `pay`, Adressleisten-Erkennung |
| Erweiterungs-Oberflächen | Popup (400×600) und Seitenleiste, mit persistenter Präferenz |
| Entwicklermodus | Live umstellbare Endpunkte (Preis-API, Developer Platform, Gateway) in den Einstellungen |

Die Schlüsselableitung ist gegen den offiziellen **SEP-5-Testvektor** verifiziert.

## Sicherheitsmodell

1. Beim Erstellen/Import wählst du ein **Passwort**; der AES-Schlüssel kommt aus `PBKDF2(Passwort, Salt, 210 000, SHA-256)`.
2. Phrase + geheimer Schlüssel werden mit `AES-256-GCM` (zufälliger IV) versiegelt und
   verschlüsselt gespeichert (`tauri-plugin-store` mobil, `localStorage` web/Erweiterung).
3. Entsperren entschlüsselt **nur im Speicher**; ein falsches Passwort scheitert am GCM-Tag.
4. Signaturen können erneut das Passwort verlangen (Einstellung). Das Dapp-Freigabefenster
   signiert lokal — kein Geheimnis erreicht je eine Seite oder einen Server.
5. **Automatische Sperre bei Inaktivität:** eine offene Sitzung hält den entschlüsselten Schlüssel,
   deshalb wird sie nach 5 Minuten ohne Interaktion verworfen und das Passwort erneut verlangt.
6. **Nichts wird signiert, was nicht vorher dekodiert wurde.** Alles, was die Wallet signiert und
   nicht selbst gebaut hat (das Envelope vom Gateway, das einer Dapp), läuft durch
   `assertSafeToSign`: dekodiert das XDR, prüft, dass die Quelle wir sind, lässt nur die
   Operationen zu, die dieser Ablauf enthalten darf, verweigert Konto-Übernahmen (`setOptions`,
   `accountMerge`, Sponsoring, Clawback), deckelt die Gebühr, lehnt Fee-Bump-Hüllen ab und begrenzt
   den Betrag auf das gerade bestätigte Angebot. Ablehnen statt warnen.
7. Die **Netzwerk-Passphrase kommt nie von der Gegenseite** — sie wird aus der eigenen
   Netzwerkkonfiguration der Wallet gelesen, damit eine "Testnet"-Freigabe keine gültige
   Mainnet-Signatur erzeugen kann. `signMessage` signiert einen domain-separierten Digest, nie die
   Bytes des Aufrufers.

> Das Passwort ist **nicht wiederherstellbar**. Falls vergessen: diese Wallet vom Gerät
> entfernen und mit ihrer Phrase wiederherstellen (andere Wallets bleiben unberührt).

## Entwicklung

Benötigt **Node ≥ 22.12** (Engine-Vorgabe von Astro 7; zusätzlich nutzen die Build- und Test-Skripte
`--experimental-strip-types`, verfügbar ab 22.6). Die CI läuft auf Node 22.

```bash
npm install
npm run dev                  # http://localhost:4500
npm run build                # -> dist/web/
npm run test:unit            # node:test, ohne Abhängigkeiten
npm run build:ext            # -> dist/extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> dist/extension-firefox/  (Firefox)
```

- **Chrome / Edge:** `chrome://extensions` → Entwicklermodus → *Entpackt laden* → `dist/extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Temporäres Add-on laden* → `dist/extension-firefox/manifest.json`.

Store-Texte: [STORE_LISTING.md](../STORE_LISTING.md).

## Hinweis

Code prüfen und gründlich im **Testnet** testen, bevor echte Mittel bewegt werden. Die
Wiederherstellungsphrase immer offline aufbewahren. Fiat-Funktionen erfordern Volljährigkeit (18+).
