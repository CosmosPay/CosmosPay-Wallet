# Cosmos · Wallet no custodial de Stellar

Wallet **no custodial** para la red **Stellar**, construida con **Astro + Vite + React (TSX)**.
Se distribuye como **app móvil** (Capacitor · Android / iOS) y como **extensión de navegador**
(MV3 · Chrome / Edge / Firefox). Interfaz con **estilo glass (glassmorphism)** animado (fondos en
movimiento, respiración del glass, animaciones de entrada y efectos hover), **tema claro y oscuro**,
**multi-idioma** (Español, English, Português, Deutsch, Français con auto-detección), tipografía
**Poppins**, botones tipo píldora y un perfil que te saluda por tu nombre. Soporta **varias wallets**
a la vez (crear / importar / cambiar) bajo una sola contraseña. Toda la lógica de criptografía y red
es real, y todo el código fuente es **TypeScript** (`.ts` / `.tsx`) — sin archivos JavaScript.

> **No custodial de verdad:** las claves se generan y se cifran en tu dispositivo. Ni la frase
> de recuperación ni la clave secreta salen nunca del teléfono/navegador. El servidor (Horizon)
> solo recibe transacciones ya firmadas localmente.

---

## ✨ Qué hace (funciones reales)

| Función | Estado | Detalle |
|---|---|---|
| Crear wallet | ✅ Real | Frase BIP-39 de 12 palabras + derivación **SEP-5** (`m/44'/148'/0'`) |
| Importar wallet | ✅ Real | Desde frase de 12/24 palabras **o** clave secreta (`S…`) |
| Exportar wallet | ✅ Real | Revela frase y clave secreta tras confirmar la contraseña |
| Almacenamiento seguro | ✅ Real | Cifrado **AES-256-GCM** con clave derivada por **PBKDF2** (210k iter.) |
| Bloqueo / desbloqueo | ✅ Real | La wallet se descifra solo en memoria al introducir la contraseña |
| Ver saldo | ✅ Real | Balances XLM + activos desde **Horizon** |
| Recibir | ✅ Real | Dirección `G…` + **QR escaneable** + copiar/compartir |
| Enviar | ✅ Real | Pago XLM firmado y enviado a la red (crea la cuenta destino si no existe) |
| Precios de mercado | ✅ Real | XLM/BTC/ETH/SOL/USDC/USDT vía CoinGecko |
| Financiar (Testnet) | ✅ Real | Friendbot: 10.000 XLM de prueba |
| Cambiar de red | ✅ Real | Testnet ⇄ Mainnet |
| Intercambiar (Swap) | ◻︎ Demo | Muestra la estimación de precio; el swap on-chain vía DEX llegará después |
| Earn / staking | ◻︎ Demo | Pantalla informativa (Stellar AMM); sin movimiento de fondos |

La derivación de claves está verificada contra el **vector de prueba oficial SEP-5**.

---

## 🔐 Modelo de seguridad

1. Al crear/importar eliges una **contraseña**.
2. Se deriva una clave AES con `PBKDF2(contraseña, salt, 210 000, SHA-256)`.
3. La frase y la clave secreta se sellan con `AES-256-GCM` (IV aleatorio) y se guardan cifradas.
4. Al desbloquear se descifran **solo en memoria**. Al recargar/cerrar hay que volver a desbloquear.
5. Contraseña equivocada → el tag de autenticación GCM falla → se rechaza.
6. En móvil el blob cifrado se guarda con `@capacitor/preferences`; en web con `localStorage`.
   El contenido siempre está cifrado, así que el almacén subyacente no necesita serlo.

> ⚠️ La contraseña **no se puede recuperar**. Si se olvida, la única vía es borrar la wallet del
> dispositivo y restaurarla con la frase de recuperación.

---

## 🧱 Tecnologías

- **Astro 7** (salida estática) + **Vite**
- **React 19 + TSX** (isla `client:only`) para toda la app interactiva
- **@stellar/stellar-sdk** (Horizon, transacciones, keypairs)
- **bip39** + **ed25519-hd-key** (mnemónico → semilla → SEP-5)
- **Web Crypto API** (PBKDF2 + AES-GCM)
- **qrcode** (QR de la dirección)
- **Capacitor** (Android / iOS, back button, clipboard, preferences)

---

## 🚀 Desarrollo

Requisitos: **Node ≥ 18**.

```bash
npm install
npm run dev        # http://localhost:4321
```

Compilar la versión de producción (genera `dist/`, que es lo que empaqueta la app móvil):

```bash
npm run build
npm run preview    # sirve dist/ localmente
```

---

## 📱 Empaquetar como app móvil (Capacitor)

El proyecto ya incluye `capacitor.config.ts` (`webDir: dist`). Para generar las apps nativas:

```bash
# 1) Compila la web
npm run build

# 2) Añade las plataformas (una vez)
npx cap add android      # requiere Android Studio + SDK
npx cap add ios          # requiere macOS + Xcode

# 3) Sincroniza el build y abre el IDE nativo
npm run cap:android      # = build + cap sync android + cap open android
npm run cap:ios          # = build + cap sync ios + cap open ios
```

Desde Android Studio / Xcode puedes ejecutar en un emulador o dispositivo y generar el
`.apk`/`.aab` o el build de App Store. Tras cualquier cambio en el código web:

```bash
npm run cap:sync         # build + cap sync
```

> El botón **atrás** de Android está integrado (navega hacia atrás en la app; sale si estás en
> la pantalla inicial). El color de fondo del splash/WebView es `#080808`.

---

## 🧩 Extensión de navegador (Chrome / Edge / Firefox · MV3)

```bash
npm run build:ext        # = astro build + empaqueta en extension/
```

Luego cárgala como extensión sin empaquetar:

- **Chrome / Edge:** `chrome://extensions` → activa *Modo desarrollador* → *Cargar
  descomprimida* → selecciona la carpeta `extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal* →
  elige `extension/manifest.json`.

La wallet se abre como **popup** del navegador (400×600). El `manifest.json` es **MV3**: los
scripts inline que genera Astro se externalizan automáticamente para cumplir
`script-src 'self'`, y el CSP permite las llamadas a Horizon, Friendbot y CoinGecko. La misma
wallet cifrada vive en el almacenamiento local de la extensión.

---

## 🌐 Redes

- **Testnet** (por defecto): XLM de prueba gratis (Friendbot). Ideal para probar enviar/recibir.
- **Mainnet**: fondos reales. Cámbiala en **Perfil → Ajustes → Red**.

La misma frase/clave deriva la **misma** cuenta en ambas redes. En Mainnet, para activar una
cuenta nueva debe recibir al menos **1 XLM** (reserva base de Stellar).

Para fijar otra red por defecto, edita `network: 'testnet'` en
`src/components/store.ts` (estado inicial) — o simplemente cámbiala desde Ajustes.

---

## 📂 Estructura

```
src/
  pages/index.astro          # punto de entrada; monta la isla React
  components/
    WalletApp.tsx            # raíz: enrutado de pantallas + back button nativo
    store.ts                 # estado global + acciones (hook useWalletStore)
    parts.tsx                # primitivos de UI (Shell, BottomNav, botones, QR badge…)
    screens/
      Onboarding.tsx         # welcome, backup, verify, import, password
      Unlock.tsx             # desbloqueo
      Main.tsx               # home, earn, markets, profile, asset
      Money.tsx              # receive, send, confirm, success, swap
      Settings.tsx           # ajustes, export
  lib/
    wallet.ts                # mnemónico + derivación SEP-5 + import
    crypto.ts                # AES-GCM + PBKDF2 (Web Crypto)
    vault.ts                 # vault cifrado (sellar/abrir/cambiar contraseña)
    storage.ts               # abstracción Preferences (nativo) / localStorage (web)
    stellar.ts               # Horizon: balances, envío, friendbot, precios
    portfolio.ts             # balances + precios → filas + total USD
    format.ts, qr.ts, clipboard.ts
capacitor.config.ts          # config de la app nativa
astro.config.ts              # Astro + React + polyfills de Node (Buffer)
scripts/serve-dist.ts        # servidor estático para previsualizar dist/
tests/wallet.e2e.ts          # prueba e2e (Playwright)
```

---

## 🧪 Pruebas (e2e)

Hay una prueba end-to-end en navegador real (Playwright) que valida la ruta crítica de
seguridad: derivación SEP-5, sellado del vault AES-GCM, persistencia, descifrado al
desbloquear y rechazo de contraseña incorrecta.

```bash
# terminal 1
npm run build
npm run serve:dist        # http://127.0.0.1:4321

# terminal 2
npx playwright install chromium   # solo la primera vez
npm run test:e2e
```

---

## ⚠️ Aviso

Software de ejemplo. Audita el código y prueba a fondo en **Testnet** antes de manejar fondos
reales en Mainnet. Guarda siempre tu frase de recuperación fuera del dispositivo.
