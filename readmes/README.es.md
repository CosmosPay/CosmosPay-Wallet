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

## Funciones

| Función | Detalle |
|---|---|
| Crear / importar / exportar wallet | BIP-39 de 12 palabras + derivación **SEP-5** (`m/44'/148'/0'`); importa desde frase o clave secreta (`S…`) |
| Vault cifrado | **AES-256-GCM**, clave derivada con **PBKDF2** (210k iteraciones); el desbloqueo descifra solo en memoria |
| Auto-bloqueo | La sesión se descarta tras 5 minutos de inactividad; volver a entrar exige la contraseña |
| Guardia de firma | `assertSafeToSign` decodifica cada XDR antes de firmarlo y rechaza lo que no encaja con el flujo (ver Modelo de seguridad) |
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

## Modelo de seguridad

1. Al crear/importar eliges una **contraseña**; la clave AES se deriva con `PBKDF2(contraseña, salt, 210 000, SHA-256)`.
2. Frase + clave secreta se sellan con `AES-256-GCM` (IV aleatorio) y se guardan cifradas
   (`@capacitor/preferences` en móvil, `localStorage` en web/extensión).
3. Desbloquear descifra **solo en memoria**; una contraseña incorrecta falla el tag GCM y se rechaza.
4. Las firmas pueden exigir la contraseña de nuevo (toggle en Ajustes). La ventana de aprobación
   de dapps firma en local — ningún secreto llega a una página o servidor.
5. **Auto-bloqueo por inactividad:** una sesión abierta guarda la clave descifrada, así que tras
   5 minutos sin interacción se descarta y se vuelve a pedir la contraseña.
6. **Nada se firma sin decodificarlo antes.** Todo sobre lo que la wallet firma y que no construyó
   ella misma (el envelope que devuelve el gateway, el que entrega una dapp) pasa por
   `assertSafeToSign`: decodifica el XDR, comprueba que el origen somos nosotros, permite solo las
   operaciones que ese flujo puede contener, rechaza las de toma de cuenta (`setOptions`,
   `accountMerge`, patrocinio, clawback), limita la comisión, rechaza envoltorios fee-bump y acota
   el importe por la cotización que el usuario acaba de confirmar. Rechaza, no avisa.
7. La **passphrase de red nunca se toma de la contraparte** — se parsea con la configuración de red
   de la propia wallet, para que una aprobación de "Testnet" no pueda producir una firma válida en
   Mainnet. `signMessage` firma un digest con separación de dominio, nunca los bytes del llamante.

> La contraseña **no se puede recuperar**. Si se olvida, borra esa wallet del dispositivo y
> restáurala con su frase (las demás wallets del dispositivo no se ven afectadas).

## Stack

**Astro 7** + **Vite** · **React 19 (TSX)** · **@stellar/stellar-sdk** · **bip39** +
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Capacitor 8** · `node:test` (unit)
· Playwright (e2e).

## Desarrollo

Requiere **Node ≥ 22.12** (lo exige el motor de Astro 7; además los scripts de build y test usan
`--experimental-strip-types`, disponible desde 22.6). CI corre sobre Node 22.

```bash
npm install
npm run dev          # http://localhost:4500 (proxy Vite: /api + /cosmos-api)
npm run dev:android  # el mismo dev server, con recarga en vivo dentro del móvil (ver Móvil)
npm run build        # dist/web/
npm run test:unit    # node:test, sin dependencias (cripto, SEP-5, importes, txGuard, i18n)
npm run test:e2e     # e2e con Playwright (ver tests/)
npm run demo         # demo de dapp para el proveedor (http://127.0.0.1:4399)
```

## Extensión de navegador (MV3)

```bash
npm run build:ext            # -> dist/extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> dist/extension-firefox/  (Firefox: sidebar + handler web+stellar)
```

Todo el output de build vive bajo `dist/` (web en `dist/web/`, extensiones en
`dist/extension[-firefox]/`, zips de release en `dist/release/`) para que las compilaciones no
ensucien la raíz del repo.

- **Chrome / Edge:** `chrome://extensions` → Modo desarrollador → *Cargar descomprimida* → `dist/extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal* → `dist/extension-firefox/manifest.json`.

Arquitectura: el popup/panel ejecutan la app completa; un content script inyecta
`window.cosmosWallet` en las páginas; las peticiones viajan por un Port hasta el service worker,
que abre la **ventana de aprobación** (`approve/`) donde el usuario desbloquea y firma en local.
Los scripts inline se externalizan en build para cumplir `script-src 'self'`; el manifest está
localizado (`_locales/`, EN/ES/PT/DE/FR). El texto para la Store está en
[STORE_LISTING.md](../STORE_LISTING.md).

## Móvil (Capacitor)

```bash
npx cap add android   # una vez por clon — /android se genera, no se versiona | npx cap add ios (macOS)
npm run cap:android   # build de release: astro build + sync + abrir Android Studio | npm run cap:ios
npm run dev:android   # build de desarrollo: recarga en vivo en el dispositivo      | npm run dev:ios
```

Android necesita el SDK de Android Studio (**Android 36** + platform-tools) y un JDK 17+; iOS,
macOS con Xcode. `dev:android` localiza el SDK en su ruta por defecto cuando `ANDROID_HOME` no está
definida — Android Studio no la exporta — así que no hay que tocar el entorno.

`@capacitor/android` y `@capacitor/ios` son **devDependencies**, junto a `@capacitor/cli`: no
aportan JavaScript a `dist/web/`, solo los leen Gradle y Xcode. `@capacitor/core` y los plugins
(`app`, `clipboard`, `preferences`) siguen en `dependencies` porque su JS **sí** se empaqueta.

`dev:android` ([scripts/cap-dev.ts](../scripts/cap-dev.ts)) arranca `astro dev --host`, apunta la
WebView a `http://<IP-LAN>:4500` mediante `cap run --live-reload` y despliega un build de debug: el
móvil recibe HMR y los proxies `/api` + `/cosmos-api`, no un bundle congelado. Solo se reescribe la
copia *nativa* de `capacitor.config.json`, y Capacitor la restaura al pulsar `Ctrl+C`.

`dev:android` compila `dist/web/`, lo sincroniza en el proyecto nativo, genera un APK de debug y lo
instala. **La app corre entonces enteramente en el dispositivo** — sin dev server, sin pedirle nada a
tu máquina. Así es como se distribuye, así que es también la única forma de ver lo que realmente hace.

El coste es que cada cambio implica otra compilación e instalación (unos segundos con Gradle
caliente), no una recarga en caliente. `--live` devuelve el HMR y los proxies `/api` + `/cosmos-api`,
a cambio de que la WebView dependa de un servidor que tiene que alcanzar.

| Flag | Para |
| --- | --- |
| `-- --no-build` | redesplegar el bundle que ya está en `dist/web/` |
| `-- --list` | listar dispositivos/emuladores conectados y salir |
| `-- --target <id>` | elegir uno cuando hay varios conectados |
| `-- --no-pair` | fallar directamente en vez de ofrecer el QR de vinculación |
| `-- --live` | recarga en vivo desde el dev server, a través de adb |
| `-- --live --lan` | recarga en vivo por la LAN (`--host <ip>` fija la dirección) |

Con `--live --lan` en Windows cuenta con el firewall: las reglas de entrada de `node.exe` se escriben
para el perfil **Público** mientras que una red doméstica es **Privada**, así que nada de la LAN
llega al puerto 4500 y la WebView muestra el `backgroundColor` de Capacitor — pantalla negra sin
error por ningún lado. `--live` a secas tuneliza por adb y evita el problema; permitir la ruta
directa requiere una PowerShell de administrador:

```powershell
New-NetFirewallRule -DisplayName "node dev server (Private)" -Direction Inbound -Action Allow `
  -Profile Private -Program "C:\Program Files\nodejs\node.exe"
```

No se usa `cap run android`: invoca `./gradlew`, que cmd.exe no puede ejecutar, y no hay flag para
cambiarlo. [scripts/cap-dev.ts](../scripts/cap-dev.ts) hace los mismos tres pasos por su cuenta —
`cap sync`, el wrapper de Gradle, y luego `native-run` para instalar y lanzar.

### Vincular un móvil por Wi-Fi

Si no hay ningún dispositivo conectado, `dev:android` imprime un QR y espera — sin cable ni driver
USB. `npm run pair:android` ([scripts/adb-pair.ts](../scripts/adb-pair.ts)) hace lo mismo por su
cuenta. En el móvil, **Ajustes → Opciones de desarrollador → Depuración inalámbrica**, y cualquiera
de sus dos pantallas:

| Pantalla del móvil | Qué pasa |
| --- | --- |
| *Vincular con código QR* | Escanea el código de la terminal. No se teclea nada: la contraseña va dentro del QR, y se imprime al lado solo para que veas qué se envió. |
| *Vincular con código de emparejamiento* | Teclea `<IP:PUERTO> <CÓDIGO>` en el prompt, tal cual lo muestra ese diálogo. El código lo genera el teléfono, así que es lo único que ningún host puede saber de antemano. |

Tras vincular se pide el dispositivo otra vez en un segundo puerto — el «Dirección IP y puerto» de la
pantalla de depuración inalámbrica. El descubrimiento lo aporta cuando funciona; si no, lo toma el
prompt, y ahí basta con el puerto porque el host ya se conoce.

El QR lleva `WIFI:T:ADB;S:<nombre>;P:<contraseña>;;`, el mismo payload que emite Android Studio. Las
dos pantallas compiten entre sí, y con el cable USB: gana la que le dé un dispositivo a adb primero.

**La ruta del QR solo funciona si funciona el mDNS entrante.** Escanear le dice al móvil en quién
confiar, no le dice al PC dónde está el móvil: su puerto llega en un anuncio
`_adb-tls-pairing._tcp` o no llega. La ruta tecleada no necesita descubrimiento en ninguna de las dos
fases, porque `adb pair` y `adb connect` marcan *hacia fuera*. Por eso el prompt está desde el primer
segundo y no después de detectar un teléfono.

En Windows, la regla de firewall de adb suele quedar limitada al perfil **Público** mientras la red en
uso es **Privada**, y entonces el descubrimiento falla en silencio — desde la terminal es idéntico a
un QR que nadie escaneó. El script lo avisa a los 20 segundos sin un solo anuncio. Para arreglarlo, en
una PowerShell **de administrador**:

```powershell
New-NetFirewallRule -DisplayName "adb (Private)" -Direction Inbound -Action Allow -Profile Private `
  -Program "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

El móvil y el PC deben estar en el mismo Wi-Fi, y en Windows esa red debe estar marcada como
**Privada** — en las Públicas se bloquea el descubrimiento mDNS.

## Redes

**Testnet** (por defecto — XLM gratis vía Friendbot) ⇄ **Mainnet** desde el selector circular de
red del header; se pueden añadir redes personalizadas (Horizon + passphrase propios). La misma
frase deriva la misma cuenta en todas las redes. Una cuenta nueva en Mainnet necesita ≥ **1 XLM**.

## Aviso

Audita el código y prueba a fondo en **Testnet** antes de manejar fondos reales. Guarda siempre
tu frase de recuperación fuera del dispositivo. Las funciones fiat requieren ser mayor de edad (18+).
