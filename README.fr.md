# Cosmos Pay · Portefeuille Stellar non dépositaire

[English](README.md) · [Español](README.es.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · **Français**

Portefeuille **non dépositaire** pour le réseau **Stellar**, construit avec **Astro + Vite +
React (TSX)**. Disponible comme **extension de navigateur** (MV3 · Chrome / Edge / Firefox —
popup **et** panneau latéral), **app mobile** (Capacitor · Android / iOS) et web. UI
**glassmorphism** animée, thèmes clair et sombre, **5 langues** (EN/ES/PT/DE/FR avec
autodétection), multi-portefeuille sous un seul mot de passe et provider dapps
(`window.cosmosWallet`) pour paiements et signatures.

> **Vraiment non dépositaire :** les clés sont générées et chiffrées sur ton appareil. Ni la
> phrase de récupération ni la clé secrète n’en sortent. Les serveurs ne reçoivent que des
> transactions déjà signées localement.

## ✨ Fonctionnalités

| Fonction | Détail |
|---|---|
| Créer / importer / exporter | BIP-39 de 12 mots + dérivation **SEP-5** (`m/44'/148'/0'`) ; import par phrase ou clé secrète (`S…`) |
| Coffre chiffré | **AES-256-GCM**, clé dérivée via **PBKDF2** (210k itérations) ; déverrouillage en mémoire uniquement |
| Soldes, envoi & réception | Horizon ; QR pour recevoir ; l’envoi de XLM crée le compte destinataire si besoin |
| Swap | Via la passerelle Cosmos Pay (devis auto, protection de slippage) |
| Fiat (on/off-ramp) | Receiver BlindPay (KYC) — dépôts et retraits, **18+ uniquement** |
| Historique | Dernières opérations avec icônes colorées (vert entrée / rouge sortie / blanc neutre) + marqueur genèse |
| Favoris & marchés | Épingle des actifs dans le top-5 ; prix en direct (CoinGecko) avec chiffres animés |
| Multi-portefeuille | Créer / importer / changer sous un seul mot de passe ; e-mail éditable, salutations selon le genre |
| Provider dapps | `window.cosmosWallet` (style SEP-43) : `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| Liens SEP-7 | `web+stellar:pay` via provider, protocol handler Firefox, mot-clé `pay` et détection dans la barre |
| Surfaces de l’extension | Popup (400×600) et panneau latéral, avec préférence persistante |
| Mode développeur | Endpoints re-pointables à chaud (API de prix, Developer Platform, passerelle) dans les Réglages |

La dérivation des clés est vérifiée contre le **vecteur de test officiel SEP-5**.

## 🔐 Modèle de sécurité

1. À la création/import tu choisis un **mot de passe** ; la clé AES vient de `PBKDF2(mot de passe, sel, 210 000, SHA-256)`.
2. Phrase + clé secrète sont scellées en `AES-256-GCM` (IV aléatoire) et stockées chiffrées
   (`@capacitor/preferences` sur mobile, `localStorage` web/extension).
3. Le déverrouillage déchiffre **en mémoire uniquement** ; un mauvais mot de passe échoue au tag GCM.
4. Les signatures peuvent redemander le mot de passe (réglage). La fenêtre d’approbation dapps
   signe en local — aucun secret n’atteint une page ou un serveur.

> ⚠️ Le mot de passe est **irrécupérable**. En cas d’oubli : supprime ce portefeuille de
> l’appareil et restaure-le avec sa phrase (les autres portefeuilles ne sont pas affectés).

## 🚀 Développement

Nécessite **Node ≥ 18**.

```bash
npm install
npm run dev                  # http://localhost:4500
npm run build:ext            # -> extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> extension-firefox/  (Firefox)
```

- **Chrome / Edge :** `chrome://extensions` → mode développeur → *Charger l’extension non empaquetée* → `extension/`.
- **Firefox :** `about:debugging#/runtime/this-firefox` → *Charger un module temporaire* → `extension-firefox/manifest.json`.

Textes pour la boutique : [STORE_LISTING.md](STORE_LISTING.md).

## ⚠️ Avertissement

Audite le code et teste à fond sur **Testnet** avant de manipuler des fonds réels. Garde toujours
ta phrase de récupération hors ligne. Les fonctions fiat exigent la majorité (18+).
