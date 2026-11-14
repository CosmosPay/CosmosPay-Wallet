# Cosmos Pay · Portefeuille multichain non dépositaire

[English](../README.md) · [Español](README.es.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · **Français**

Portefeuille **non dépositaire** pour **Stellar et 34 autres réseaux** (tous ceux que règlent les
swaps entre réseaux : les chaînes EVM, Solana, Bitcoin, XRP Ledger, Tron, TON, NEAR, Sui, Aptos,
Cardano, Starknet et plus), construit avec **Astro + Vite + React (TSX)**. Une seule phrase de
récupération est une adresse sur chacun. Disponible comme **extension de navigateur** (MV3 · Chrome /
Edge / Firefox, popup **et** panneau latéral), **app de bureau** (Tauri · Windows / macOS / Linux),
**app mobile** (Tauri · Android / iOS) et web. UI plate et mate, thèmes clair et sombre, **5 langues** (EN/ES/PT/DE/FR ; anglais par défaut,
un lien peut en indiquer une : `?lang=fr`), multi-portefeuille sous un seul mot de passe et provider dapps
(`window.cosmosWallet`) pour paiements et signatures.

> **Vraiment non dépositaire :** les clés sont générées et chiffrées sur ton appareil. Ni la
> phrase de récupération ni la clé secrète n’en sortent. Les serveurs ne reçoivent que des
> transactions déjà signées localement.

## Fonctionnalités

| Fonction | Détail |
|---|---|
| Créer / importer / exporter | BIP-39 de 12 mots + dérivation **SEP-5** (`m/44'/148'/0'`) ; import par phrase ou clé secrète (`S…`) |
| Coffre chiffré | **AES-256-GCM**, clé dérivée via **PBKDF2** (600k itérations ; les anciennes boîtes à 210k sont rescellées au premier déverrouillage) ; déverrouillage en mémoire uniquement |
| Session & verrouillage auto | La session survit à un rechargement, à la fermeture du popup et au redémarrage du navigateur, et revient à l’écran où elle était, jusqu’à ce que le verrouillage par inactivité (15 min, 1 h, 1 jour par défaut ou 7 jours, dans les Réglages) la jette |
| Garde de signature | `assertSafeToSign` décode chaque XDR avant de signer et refuse ce qui ne correspond pas au flux (voir Modèle de sécurité) |
| Soldes, envoi & réception | Chaque réseau, lu depuis son propre endpoint public (une lecture échouée s’affiche comme indisponible, jamais comme zéro). Envoi sur chaque réseau où le portefeuille a une adresse ; QR pour recevoir ; l’envoi de XLM crée le compte destinataire si besoin |
| Swap | Via la passerelle Cosmos Pay (devis auto, protection de slippage) |
| Fiat (on/off-ramp) | Receiver BlindPay (KYC) : dépôts et retraits par PIX, SPEI, virements en ARS, PSE, TED, ACH, wire et RTP, **18+ uniquement** |
| Acheter et vendre en monnaie locale (P2P) | Via l’API Cosmos Pay (`/v1/onramp/p2p`, `/v1/offramp/p2p`), la même rampe que les vues Fiat de la plateforme développeurs : chaque monnaie locale avec ses moyens de paiement (virement bancaire, PIX, Nequi, Bancolombia, Yape, Plin, Zelle et plus), chaque réseau et token du marché sur lequel le portefeuille a une adresse, et un prix ferme quand le déploiement en propose un. L’ordre s’ouvre dans une fenêtre hébergée où la personne se connecte, vérifie son identité et paie ou est payée ; un achat arrive à l’adresse du portefeuille, une vente en part (signée par l’extension du navigateur). Le mode test utilise le marché de test (USDT de test sur Arbitrum Sepolia). Voir [src/lib/p2pRamp.ts](../src/lib/p2pRamp.ts) |
| Encaisser avec un QR en monnaie locale | Affiche un QR pour un montant en monnaie locale (d’abord l’ARS) : le client le scanne, paie par virement ou un moyen local sur une page hébergée, et le token arrive sur le compte EVM du portefeuille par le même achat P2P. Créé avec la clé du compte ou la clé publique partagée (`/v1/onramp/p2p/payment-requests`) ; le portefeuille voit le paiement par l’API ou par la hausse de son propre solde. Voir [src/lib/qrCharge.ts](../src/lib/qrCharge.ts) |
| Activité | L’onglet Activité de l’Accueil, par jour : un envoi en rouge, l’argent reçu en vert, un swap en bleu, une commission à l’encre avec sa propre marque de reçu |
| Favoris & marchés | Épingle des actifs dans le top-5 ; prix en direct (CoinGecko) avec chiffres animés |
| Multi-portefeuille | Créer / importer / changer sous un seul mot de passe ; e-mail éditable, salutations selon le genre |
| Provider dapps | `window.cosmosWallet` (style SEP-43) : `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| Liens SEP-7 | `web+stellar:pay` via provider, protocol handler Firefox, mot-clé `pay` et détection dans la barre |
| Surfaces de l’extension | Popup (400×600) et panneau latéral, avec préférence persistante |
| Mode développeur | Endpoints re-pointables à chaud (API de prix, passerelle de paiement, les deux serveurs de récupération, RPC Solana / Monad) dans les Réglages |

La dérivation des clés est vérifiée contre le **vecteur de test officiel SEP-5**.

## Modèle de sécurité

1. À la création/import tu choisis un **mot de passe** ; la clé AES vient de `PBKDF2(mot de passe, sel, 600 000, SHA-256)`.
2. Phrase + clé secrète sont scellées en `AES-256-GCM` (IV aléatoire) et stockées chiffrées
   (`tauri-plugin-store` sur mobile, `localStorage` web/extension).
3. Le déverrouillage déchiffre **en mémoire uniquement** ; un mauvais mot de passe échoue au tag GCM.
4. Les signatures peuvent redemander le mot de passe (réglage). La fenêtre d’approbation dapps
   signe en local — aucun secret n’atteint une page ou un serveur.
   **Passkey au lieu du mot de passe** (web, extension, bureau et les apps sur Android 9+ / iOS 18+) : le mot de passe de l’app
   devient 32 octets aléatoires scellés sous la sortie PRF WebAuthn de la passkey, donc
   l’empreinte ouvre l’appareil et la même passkey ouvre la sauvegarde sur le suivant.
5. **Verrouillage automatique par inactivité :** une session ouverte détient la clé du coffre ; le
   verrouillage auto (Réglages : 15 min, 1 h, 1 jour par défaut, 7 jours) la jette et le mot de passe
   est redemandé. D’ici là, la session est conservée entre rechargements sous une clé de navigateur
   non extractible.
6. **Rien n’est signé sans avoir été décodé.** Tout ce que le portefeuille signe sans l’avoir
   construit lui-même (l’enveloppe renvoyée par la passerelle, celle fournie par une dapp) passe
   par `assertSafeToSign` : décodage du XDR, vérification que la source est bien nous, liste
   blanche des seules opérations que ce flux peut contenir, refus des prises de contrôle de compte
   (`setOptions`, `accountMerge`, parrainage, clawback), plafond de frais, refus des enveloppes
   fee-bump et borne du montant par le devis que l’utilisateur vient de confirmer. Refuser, pas
   avertir.
7. La **passphrase réseau n’est jamais prise chez la contrepartie** — elle vient de la
   configuration réseau du portefeuille, pour qu’une approbation « Testnet » ne puisse pas produire
   une signature valide sur Mainnet. `signMessage` signe un digest à séparation de domaine, jamais
   les octets de l’appelant.

> Le mot de passe est **irrécupérable**. En cas d’oubli : supprime ce portefeuille de
> l’appareil et restaure-le avec sa phrase (les autres portefeuilles ne sont pas affectés).

## Développement

Nécessite **Node ≥ 22.12** (exigé par le moteur d’Astro 7 ; de plus les scripts de build et de test
utilisent `--experimental-strip-types`, disponible depuis 22.6). La CI tourne sur Node 22.

```bash
npm install
npm run dev                  # http://localhost:4500
npm run build                # -> dist/web/
npm run test:unit            # node:test, sans dépendances
npm run build:ext            # -> dist/extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> dist/extension-firefox/  (Firefox)
```

- **Chrome / Edge :** `chrome://extensions` → mode développeur → *Charger l’extension non empaquetée* → `dist/extension/`.
- **Firefox :** `about:debugging#/runtime/this-firefox` → *Charger un module temporaire* → `dist/extension-firefox/manifest.json`.

Textes pour la boutique : [STORE_LISTING.md](../STORE_LISTING.md).

## Avertissement

Audite le code et teste à fond sur **Testnet** avant de manipuler des fonds réels. Garde toujours
ta phrase de récupération hors ligne. Les fonctions fiat exigent la majorité (18+).
