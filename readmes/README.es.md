# Cosmos Pay · Wallet no custodial de Stellar

[English](../README.md) · **Español** · [Português](README.pt.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Wallet **no custodial** para la red **Stellar**, construida con **Astro + Vite + React (TSX)**.
Se distribuye como **extensión de navegador** (MV3 · Chrome / Edge / Firefox — popup **y** panel
lateral), **app móvil** (Capacitor · Android / iOS) y web. Interfaz **glassmorphism** animada,
tema claro y oscuro, **5 idiomas** (EN/ES/PT/DE/FR con autodetección), multi-wallet bajo una sola
contraseña y proveedor para dapps (`window.cosmosWallet`) para que las webs pidan pagos y firmas.

> **No custodial de verdad:** las claves se generan y cifran en tu dispositivo. Ni la frase de
> recuperación ni la clave secreta salen nunca de él. Los servidores solo reciben transacciones
> ya firmadas localmente.

## ✨ Funciones

| Función | Detalle |
|---|---|
| Crear / importar / exportar wallet | BIP-39 de 12 palabras + derivación **SEP-5** (`m/44'/148'/0'`); importa desde frase o clave secreta (`S…`) |
| Vault cifrado | **AES-256-GCM**, clave derivada con **PBKDF2** (210k iteraciones); el desbloqueo descifra solo en memoria |
| Saldos, enviar y recibir | Horizon; QR para recibir; el envío de XLM crea la cuenta destino si no existe |
| Swap | Vía el gateway de Cosmos Pay (cotización automática, protección de slippage) |
| Fiat (on/off-ramp) | Receiver BlindPay (KYC) — depósitos y retiros, **solo 18+** |
| Historial | Últimas operaciones con iconos por color (verde entra / rojo sale / blanco neutro) + marcador génesis |
| Favoritos y mercados | Marca activos con estrella para fijarlos en el top-5; precios en vivo (CoinGecko) con números animados |
| Multi-wallet | Crear / importar / cambiar bajo una contraseña; correo editable y saludos según género |
| Proveedor para dapps | `window.cosmosWallet` (estilo SEP-43): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| Enlaces SEP-7 | `web+stellar:pay` vía proveedor, protocol handler en Firefox, keyword `pay` en la barra y detección automática |
| Superficies de la extensión | Popup (400×600) y panel lateral, con botón de preferencia persistente |
| Modo desarrollador | Endpoints re-apuntables en vivo (API de precios, Developer Platform, gateway) desde Ajustes |

La derivación de claves está verificada contra el **vector de prueba oficial SEP-5**.

## 🔐 Modelo de seguridad

1. Al crear/importar eliges una **contraseña**; la clave AES se deriva con `PBKDF2(contraseña, salt, 210 000, SHA-256)`.
2. Frase + clave secreta se sellan con `AES-256-GCM` (IV aleatorio) y se guardan cifradas
   (`@capacitor/preferences` en móvil, `localStorage` en web/extensión).
3. Desbloquear descifra **solo en memoria**; una contraseña incorrecta falla el tag GCM y se rechaza.
4. Las firmas pueden exigir la contraseña de nuevo (toggle en Ajustes). La ventana de aprobación
   de dapps firma en local — ningún secreto llega a una página o servidor.

> ⚠️ La contraseña **no se puede recuperar**. Si se olvida, borra esa wallet del dispositivo y
> restáurala con su frase (las demás wallets del dispositivo no se ven afectadas).

## 🧱 Stack

**Astro 7** + **Vite** · **React 19 (TSX)** · **@stellar/stellar-sdk** · **bip39** +
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Capacitor 8** · Playwright (e2e).

## 🚀 Desarrollo

Requiere **Node ≥ 18**.

```bash
npm install
npm run dev          # http://localhost:4500 (proxy Vite: /api + /cosmos-api)
npm run build        # dist/
npm run test:e2e     # e2e con Playwright (ver tests/)
npm run demo         # demo de dapp para el proveedor (http://127.0.0.1:4399)
```

## 🧩 Extensión de navegador (MV3)

```bash
npm run build:ext            # -> extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> extension-firefox/  (Firefox: sidebar + handler web+stellar)
```

- **Chrome / Edge:** `chrome://extensions` → Modo desarrollador → *Cargar descomprimida* → `extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal* → `extension-firefox/manifest.json`.

Arquitectura: el popup/panel ejecutan la app completa; un content script inyecta
`window.cosmosWallet` en las páginas; las peticiones viajan por un Port hasta el service worker,
que abre la **ventana de aprobación** (`approve/`) donde el usuario desbloquea y firma en local.
Los scripts inline se externalizan en build para cumplir `script-src 'self'`; el manifest está
localizado (`_locales/`, EN/ES/PT/DE/FR). El texto para la Store está en
[STORE_LISTING.md](../STORE_LISTING.md).

## 📱 Móvil (Capacitor)

```bash
npm run build
npx cap add android   # una vez (Android Studio)  |  npx cap add ios (macOS + Xcode)
npm run cap:android   # build + sync + abrir      |  npm run cap:ios
```

## 🌐 Redes

**Testnet** (por defecto — XLM gratis vía Friendbot) ⇄ **Mainnet** desde el selector circular de
red del header; se pueden añadir redes personalizadas (Horizon + passphrase propios). La misma
frase deriva la misma cuenta en todas las redes. Una cuenta nueva en Mainnet necesita ≥ **1 XLM**.

## ⚠️ Aviso

Audita el código y prueba a fondo en **Testnet** antes de manejar fondos reales. Guarda siempre
tu frase de recuperación fuera del dispositivo. Las funciones fiat requieren ser mayor de edad (18+).
