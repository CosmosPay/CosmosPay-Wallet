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

No network names, token names or technical standards in the public descriptions (this one, the
summary and their translations). The Chrome Web Store rejected 1.23.1 for keyword spam over a
list of ten network names in this field (violation "Yellow Argon", 2026-11-24). Say "more than
30 networks" instead. The permission justifications below are read only by the reviewers and
may stay technical.

```
Cosmos Pay Wallet is a non-custodial crypto wallet that works on more than 30 networks. Your keys are generated and encrypted on your device, and every transaction is signed there.

FEATURES
• One recovery phrase gives you an address on every supported network. Create a new wallet with a 12-word phrase, or import the one you already have.
• Send and receive crypto and stablecoins, with a QR code for each address.
• Swap between tokens and networks with live quotes and slippage control.
• Buy and sell crypto with local money.
• See your balances by network and asset and your activity, and pin your favorites to the top.
• Unlock with a passkey instead of typing your password, on devices that support it.
• Move your wallet to another device with a QR code and a one-time code.
• Keep several wallets under one password. Available in 5 languages, with light and dark themes.
• Use it as a toolbar popup or in the side panel.
• Connect to websites that support browser wallets, or to any site through WalletConnect. Every request opens an approval window where you review and confirm it; nothing is signed without your password or passkey.

SECURITY
Your recovery phrase and keys are encrypted with AES-256-GCM under a key derived from your password. They are decrypted only in memory while the wallet is unlocked, and the wallet locks itself after the idle time you choose. Every transaction is shown to you before it is signed. The optional cloud backup is encrypted on your device before it is uploaded, and only your own password or passkey can open it.

Test networks are one tap away for developers.

Always keep your recovery phrase safe and offline.
```

Every language the wallet speaks gets the same text in the listing (Store listing → language).

**Español (descripción):**
```
Cosmos Pay Wallet es una wallet cripto no custodial que funciona en más de 30 redes. Tus claves se generan y se cifran en tu dispositivo, y cada transacción se firma ahí.

FUNCIONES
• Una sola frase de recuperación te da una dirección en cada red compatible. Crea una wallet nueva con una frase de 12 palabras o importa la que ya tienes.
• Envía y recibe cripto y stablecoins, con un código QR para cada dirección.
• Intercambia entre tokens y redes con cotizaciones en vivo y control de slippage.
• Compra y vende cripto con moneda local.
• Mira tus saldos por red y por activo y tu actividad, y fija tus favoritos arriba.
• Desbloquea con una passkey en lugar de escribir tu contraseña, en los dispositivos que lo permiten.
• Pasa tu wallet a otro dispositivo con un código QR y un código de un solo uso.
• Varias wallets con una sola contraseña. Disponible en 5 idiomas, con tema claro y oscuro.
• Úsala como ventana de la barra de herramientas o en el panel lateral.
• Conéctate a los sitios que aceptan wallets de navegador, o a cualquier sitio con WalletConnect. Cada solicitud abre una ventana de aprobación donde la revisas y la confirmas; nada se firma sin tu contraseña o tu passkey.

SEGURIDAD
Tu frase de recuperación y tus claves se cifran con AES-256-GCM con una clave derivada de tu contraseña. Solo se descifran en memoria mientras la wallet está desbloqueada, y la wallet se bloquea sola después del tiempo de inactividad que elijas. Cada transacción se te muestra antes de firmarla. La copia de seguridad opcional en la nube se cifra en tu dispositivo antes de subirse, y solo tu contraseña o tu passkey la abren.

Las redes de prueba están a un toque para desarrolladores.

Guarda siempre tu frase de recuperación en un lugar seguro y sin conexión.
```

**Português (Brasil):**
```
A Cosmos Pay Wallet é uma carteira cripto não custodial que funciona em mais de 30 redes. Suas chaves são geradas e cifradas no seu dispositivo, e cada transação é assinada nele.

RECURSOS
• Uma única frase de recuperação dá a você um endereço em cada rede compatível. Crie uma carteira nova com uma frase de 12 palavras ou importe a que você já tem.
• Envie e receba cripto e stablecoins, com um código QR para cada endereço.
• Troque entre tokens e redes com cotações em tempo real e controle do deslize máximo.
• Compre e venda cripto com moeda local.
• Veja seus saldos por rede e por ativo e sua atividade, e fixe seus favoritos no topo.
• Desbloqueie com uma passkey em vez de digitar sua senha, nos dispositivos compatíveis.
• Leve sua carteira para outro dispositivo com um código QR e um código de uso único.
• Várias carteiras com uma única senha. Disponível em 5 idiomas, com tema claro e escuro.
• Use como janela da barra de ferramentas ou no painel lateral.
• Conecte-se a sites que aceitam carteiras de navegador, ou a qualquer site pelo WalletConnect. Cada solicitação abre uma janela de aprovação onde você a revisa e confirma; nada é assinado sem sua senha ou sua passkey.

SEGURANÇA
Sua frase de recuperação e suas chaves são cifradas com AES-256-GCM com uma chave derivada da sua senha. Elas só são decifradas na memória enquanto a carteira está desbloqueada, e a carteira se bloqueia sozinha após o tempo de inatividade que você escolher. Cada transação é mostrada a você antes de ser assinada. O backup opcional na nuvem é cifrado no seu dispositivo antes de ser enviado, e só a sua senha ou a sua passkey podem abri-lo.

As redes de teste estão a um clique para desenvolvedores.

Guarde sempre sua frase de recuperação em um lugar seguro e offline.
```

**Deutsch:**
```
Cosmos Pay Wallet ist eine nicht-verwahrende Krypto-Wallet für mehr als 30 Netzwerke. Ihre Schlüssel werden auf Ihrem Gerät erzeugt und verschlüsselt, und jede Transaktion wird dort signiert.

FUNKTIONEN
• Eine einzige Wiederherstellungsphrase gibt Ihnen eine Adresse in jedem unterstützten Netzwerk. Erstellen Sie eine neue Wallet mit einer Phrase aus 12 Wörtern oder importieren Sie Ihre bestehende.
• Senden und empfangen Sie Krypto und Stablecoins, mit einem QR-Code für jede Adresse.
• Tauschen Sie zwischen Token und Netzwerken mit Live-Kursen und einstellbarem maximalem Slippage.
• Kaufen und verkaufen Sie Krypto mit lokaler Währung.
• Sehen Sie Ihre Guthaben nach Netzwerk und Asset sowie Ihre Aktivität, und heften Sie Ihre Favoriten oben an.
• Entsperren Sie mit einem Passkey statt mit Ihrem Passwort, auf Geräten, die das unterstützen.
• Übertragen Sie Ihre Wallet mit einem QR-Code und einem Einmalcode auf ein anderes Gerät.
• Mehrere Wallets unter einem Passwort. Verfügbar in 5 Sprachen, mit hellem und dunklem Design.
• Nutzen Sie sie als Pop-up in der Symbolleiste oder in der Seitenleiste.
• Verbinden Sie sich mit Websites, die Browser-Wallets unterstützen, oder über WalletConnect mit jeder Website. Jede Anfrage öffnet ein Freigabefenster, in dem Sie sie prüfen und bestätigen; ohne Ihr Passwort oder Ihren Passkey wird nichts signiert.

SICHERHEIT
Ihre Wiederherstellungsphrase und Ihre Schlüssel werden mit AES-256-GCM verschlüsselt, unter einem Schlüssel, der aus Ihrem Passwort abgeleitet wird. Entschlüsselt werden sie nur im Arbeitsspeicher, solange die Wallet entsperrt ist, und die Wallet sperrt sich nach der von Ihnen gewählten Inaktivitätszeit selbst. Jede Transaktion wird Ihnen angezeigt, bevor sie signiert wird. Das optionale Cloud-Backup wird auf Ihrem Gerät verschlüsselt, bevor es hochgeladen wird, und nur Ihr eigenes Passwort oder Ihr Passkey kann es öffnen.

Testnetzwerke sind für Entwickler nur einen Klick entfernt.

Bewahren Sie Ihre Wiederherstellungsphrase immer sicher und offline auf.
```

**Français:**
```
Cosmos Pay Wallet est un portefeuille crypto non dépositaire qui fonctionne sur plus de 30 réseaux. Vos clés sont générées et chiffrées sur votre appareil, et chaque transaction y est signée.

FONCTIONNALITÉS
• Une seule phrase de récupération vous donne une adresse sur chaque réseau pris en charge. Créez un nouveau portefeuille avec une phrase de 12 mots, ou importez celle que vous avez déjà.
• Envoyez et recevez des cryptos et des stablecoins, avec un code QR pour chaque adresse.
• Échangez entre jetons et réseaux avec des cotations en direct et un glissement maximal réglable.
• Achetez et vendez des cryptos en monnaie locale.
• Consultez vos soldes par réseau et par actif ainsi que votre activité, et épinglez vos favoris en haut.
• Déverrouillez avec une passkey au lieu de saisir votre mot de passe, sur les appareils compatibles.
• Transférez votre portefeuille vers un autre appareil avec un code QR et un code à usage unique.
• Plusieurs portefeuilles sous un seul mot de passe. Disponible en 5 langues, avec thèmes clair et sombre.
• Utilisez-le en fenêtre depuis la barre d'outils ou dans le panneau latéral.
• Connectez-vous aux sites compatibles avec les portefeuilles de navigateur, ou à n'importe quel site via WalletConnect. Chaque demande ouvre une fenêtre d'approbation où vous la vérifiez et la confirmez ; rien n'est signé sans votre mot de passe ou votre passkey.

SÉCURITÉ
Votre phrase de récupération et vos clés sont chiffrées avec AES-256-GCM sous une clé dérivée de votre mot de passe. Elles ne sont déchiffrées qu'en mémoire tant que le portefeuille est déverrouillé, et le portefeuille se verrouille tout seul après le délai d'inactivité que vous choisissez. Chaque transaction vous est présentée avant d'être signée. La sauvegarde facultative dans le cloud est chiffrée sur votre appareil avant d'être envoyée, et seul votre mot de passe ou votre passkey peut l'ouvrir.

Les réseaux de test sont à un clic pour les développeurs.

Conservez toujours votre phrase de récupération en lieu sûr et hors ligne.
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
