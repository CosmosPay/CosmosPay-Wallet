# Cosmos Pay · Nicht-verwahrende Multichain-Wallet

[English](../README.md) · [Español](README.es.md) · [Português](README.pt.md) · **Deutsch** · [Français](README.fr.md)

**Nicht-verwahrende** Wallet für **Stellar und 34 weitere Netzwerke** (alle, die die netzwerkübergreifenden
Swaps abwickeln: die EVM-Chains, Solana, Bitcoin, XRP Ledger, Tron, TON, NEAR, Sui, Aptos, Cardano,
Starknet und mehr), gebaut mit **Astro + Vite + React (TSX)**. Eine Wiederherstellungsphrase ist auf
jedem davon eine Adresse. Erhältlich als **Browser-Erweiterung** (MV3 · Chrome / Edge / Firefox,
Popup **und** Seitenleiste), **Desktop-App** (Tauri · Windows / macOS / Linux), **Mobile App**
(Tauri · Android / iOS) und Web. Flaches, mattes UI, heller und
dunkler Modus, **5 Sprachen** (EN/ES/PT/DE/FR; standardmäßig Englisch, ein Link kann eine vorgeben: `?lang=de`), Multi-Wallet unter einem
Passwort und ein Dapp-Provider (`window.cosmosWallet`) für Zahlungen und Signaturen.

> **Wirklich non-custodial:** Schlüssel werden auf deinem Gerät erzeugt und verschlüsselt. Weder
> die Wiederherstellungsphrase noch der geheime Schlüssel verlassen es. Server erhalten nur
> lokal signierte Transaktionen.

## Funktionen

| Funktion | Detail |
|---|---|
| Wallet erstellen / importieren / exportieren | 12-Wörter-BIP-39 + **SEP-5**-Ableitung (`m/44'/148'/0'`); Import per Phrase oder geheimem Schlüssel (`S…`) |
| Verschlüsselter Tresor | **AES-256-GCM**, Schlüssel via **PBKDF2** (600k Iterationen; ältere 210k-Boxen werden beim ersten Entsperren neu versiegelt); Entsperren entschlüsselt nur im Speicher |
| Sitzung & automatische Sperre | Die Sitzung übersteht ein Neuladen, ein geschlossenes Popup und einen Browser-Neustart und kehrt zum letzten Bildschirm zurück, bis die Inaktivitätssperre (15 Min., 1 Std., standardmäßig 1 Tag oder 7 Tage, in den Einstellungen) sie verwirft |
| Signatur-Wächter | `assertSafeToSign` dekodiert jedes XDR vor dem Signieren und lehnt ab, was nicht zum Ablauf passt (siehe Sicherheitsmodell) |
| Guthaben, Senden & Empfangen | Jedes Netzwerk, jeweils über seinen eigenen öffentlichen Endpunkt gelesen (ein fehlgeschlagener Abruf erscheint als nicht verfügbar, nie als null). Senden auf jedem Netzwerk mit einer Adresse der Wallet; QR zum Empfangen; XLM-Versand erstellt das Zielkonto bei Bedarf |
| Swap | Über das Cosmos-Pay-Gateway (Auto-Quotes, Slippage-Schutz) |
| Fiat (On/Off-Ramp) | BlindPay-Receiver (KYC): Ein- und Auszahlungen per PIX, SPEI, ARS-Überweisung, PSE, TED, ACH, Wire und RTP, **nur 18+** |
| Mit Landeswährung kaufen und verkaufen (P2P) | Über die Cosmos-Pay-API (`/v1/onramp/p2p`, `/v1/offramp/p2p`), dieselbe Rampe wie in den Fiat-Ansichten der Entwicklerplattform: jede Landeswährung mit ihren Zahlungsmethoden (Banküberweisung, PIX, Nequi, Bancolombia, Yape, Plin, Zelle und mehr), jedes Netzwerk und jeder Token des Marktes, auf dem die Wallet eine Adresse hat, und ein fester Kurs, wenn die Installation ihn anbietet. Die Order öffnet sich in einem gehosteten Fenster, in dem sich die Person anmeldet, ihre Identität bestätigt und zahlt oder bezahlt wird; ein Kauf kommt an der eigenen Adresse der Wallet an, ein Verkauf wird von ihr gesendet (signiert von der Browser-Erweiterung). Der Testmodus nutzt den Testmarkt (Test-USDT auf Arbitrum Sepolia). Siehe [src/lib/p2pRamp.ts](../src/lib/p2pRamp.ts) |
| Mit QR-Code in Landeswährung kassieren | Zeigt einen QR-Code über einen Betrag in Landeswährung (zuerst ARS): Der Kunde scannt ihn, zahlt per Überweisung oder einer lokalen Methode auf einer gehosteten Seite, und der Token kommt über denselben P2P-Kauf auf dem eigenen EVM-Konto der Wallet an. Erstellt mit dem Schlüssel des Kontos oder dem geteilten öffentlichen Schlüssel (`/v1/onramp/p2p/payment-requests`); die Wallet erkennt die Zahlung über die API oder am steigenden eigenen Guthaben. Siehe [src/lib/qrCharge.ts](../src/lib/qrCharge.ts) |
| Aktivität | Der Aktivität-Tab der Startseite, nach Tagen: ein Versand rot, empfangenes Geld grün, ein Swap blau, eine Provision in Tinte mit eigenem Belegsymbol |
| Favoriten & Märkte | Assets anpinnen (Top-5); Live-Preise (CoinGecko) mit animierten Zahlen |
| Multi-Wallet | Erstellen / importieren / wechseln unter einem Passwort; editierbare E-Mail, geschlechtergerechte Begrüßungen |
| Dapp-Provider | `window.cosmosWallet` (SEP-43-Stil): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| SEP-7-Links | `web+stellar:pay` via Provider, Firefox-Protocol-Handler, Omnibox-Keyword `pay`, Adressleisten-Erkennung |
| Erweiterungs-Oberflächen | Popup (400×600) und Seitenleiste, mit persistenter Präferenz |
| Entwicklermodus | Live umstellbare Endpunkte (Preis-API, Zahlungs-Gateway, die zwei Wiederherstellungsserver, Solana-/Monad-RPC) in den Einstellungen |

Die Schlüsselableitung ist gegen den offiziellen **SEP-5-Testvektor** verifiziert.

## Sicherheitsmodell

1. Beim Erstellen/Import wählst du ein **Passwort**; der AES-Schlüssel kommt aus `PBKDF2(Passwort, Salt, 600 000, SHA-256)`.
2. Phrase + geheimer Schlüssel werden mit `AES-256-GCM` (zufälliger IV) versiegelt und
   verschlüsselt gespeichert (`tauri-plugin-store` mobil, `localStorage` web/Erweiterung).
3. Entsperren entschlüsselt **nur im Speicher**; ein falsches Passwort scheitert am GCM-Tag.
4. Signaturen können erneut das Passwort verlangen (Einstellung). Das Dapp-Freigabefenster
   signiert lokal — kein Geheimnis erreicht je eine Seite oder einen Server.
   **Passkey statt Passwort** (Web, Erweiterung, Desktop und die Apps ab Android 9 / iOS 18): Das App-Passwort wird zu 32
   Zufallsbytes, versiegelt unter der WebAuthn-PRF-Ausgabe des Passkeys — der Fingerabdruck
   öffnet das Gerät, und derselbe Passkey öffnet die Cloud-Sicherung auf dem nächsten.
5. **Automatische Sperre bei Inaktivität:** eine offene Sitzung hält den Tresorschlüssel, deshalb
   verwirft die automatische Sperre (Einstellungen: 15 Min., 1 Std., standardmäßig 1 Tag, 7 Tage)
   sie und das Passwort wird erneut verlangt. Bis dahin bleibt die Sitzung über Neuladen hinweg
   unter einem nicht exportierbaren Browser-Schlüssel erhalten.
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
