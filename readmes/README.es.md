# Cosmos Pay · Wallet no custodial de Stellar

[English](../README.md) · **Español** · [Português](README.pt.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Wallet **no custodial** para la red **Stellar**, construida con **Astro + Vite + React (TSX)**.
Se distribuye como **extensión de navegador** (MV3 · Chrome / Edge / Firefox — popup **y** panel
lateral), **app de escritorio** (Tauri · Windows / macOS / Linux), **app móvil** (Tauri · Android /
iOS) y web. Interfaz **glassmorphism** animada,
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
   (`tauri-plugin-store` en escritorio y móvil, `localStorage` en web/extensión — en
   [src/lib/storage.ts](../src/lib/storage.ts) está por qué el almacenamiento propio de una
   WebView no basta para guardar una bóveda).
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
**ed25519-hd-key** · Web Crypto (PBKDF2/AES-GCM) · **qrcode** · **Tauri 2** (escritorio y móvil,
Rust) · `node:test` (unit) · Playwright (e2e).

## Desarrollo

Requiere **Node ≥ 22.12** (lo exige el motor de Astro 7; además los scripts de build y test usan
`--experimental-strip-types`, disponible desde 22.6). CI corre sobre Node 22.

```bash
npm install
npm run dev          # http://localhost:4500 (proxy Vite: /api + /cosmos-api)
npm run desktop:dev  # la misma app en una ventana nativa (ver Escritorio)
npm run android:dev  # ...y en un móvil conectado (ver Móvil)
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

## Escritorio (Tauri)

```bash
npm run desktop:dev     # ventana nativa contra el dev server (HMR + los proxies /api)
npm run desktop:build   # instaladores en src-tauri/target/release/bundle/
npm run desktop:icons   # regenera src-tauri/icons/ desde public/logo-white.png
```

Necesita el **toolchain de Rust** (1.77.2+) y la WebView de cada plataforma: WebView2 en Windows
(ya viene en Windows 11), WebKitGTK 4.1 + libsoup3 en Linux, nada extra en macOS. `desktop:build`
produce un instalador NSIS y un MSI en Windows, un `.dmg` en macOS, y AppImage + `.deb` + `.rpm`
en Linux.

El lado Rust es deliberadamente pequeño — [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) es una
lista de plugins y nada más. No hay plugin de filesystem, shell, http ni process: el frontend
sostiene material de claves descifrado, así que cada comando registrado ahí es algo que un XSS en el
bundle también podría llamar. Qué se registra, y por qué, está documentado en ese archivo.

Dos cosas que una WebView hace mal se tratan explícitamente. `crypto.subtle` exige un **contexto
seguro**, y por eso la app se sirve desde el esquema propio de Tauri y no desde `file://` — ahí la
bóveda sencillamente no descifraría. Y `target="_blank"` no tiene dónde abrirse en una ventana sin
chrome de navegador, así que en algunos motores navega la wallet **en el sitio**, reemplazando el
documento que sostiene la sesión; cada enlace saliente pasa por
[src/ui/ExternalLink.tsx](../src/ui/ExternalLink.tsx).

### Diseño de escritorio

A partir de `--desk-min` (1024px) la columna de teléfono se convierte en una **ventana**: una
tarjeta acotada con un riel de navegación en su borde izquierdo y la columna de pantalla centrada al
lado. Ninguna de las cuarenta pantallas cambia — siguen renderizando en una columna de ancho
aproximadamente telefónico, que es para lo que se diseñaron. Lo que cambia es el marco alrededor.

Qué navegación se ve lo decide **el CSS**. Tanto [src/app/DesktopNav.tsx](../src/app/DesktopNav.tsx)
como [src/app/BottomNav.tsx](../src/app/BottomNav.tsx) entran en el DOM y una media query oculta
una, así que no hay ningún listener de resize en la app ni nada que pueda contradecirse. El riel
está atado a la **sesión**, no al viewport: un riel de 252px que apareciera y desapareciera en cada
navegación reflowearía la ventana entera, mientras que la barra inferior a la que sustituye solo
flotaba sobre el contenido.

Esto vale también para la build web — una pestaña de navegador a 1400px es una ventana de escritorio,
haya Tauri o no. La extensión queda fuera por una clase y no por ancho, porque un panel lateral de
Chrome se puede arrastrar más allá de 1024px y debe seguir siendo una sola columna con su cajón.

`npm run test:responsive` recorre 320px → 1920px comprobando que nada desborda, y sondea un píxel a
cada lado de `--desk-min` — el token y los dos literales de media query no tienen nada más que los
mantenga sincronizados. El riel en sí se comprueba al final de `npm run test:e2e`, que para entonces
ya tiene sesión iniciada.

## Móvil (Tauri)

```bash
npm run android:init    # una vez por clon — genera src-tauri/gen/android y restaura el arte
npm run android:dev     # compila, instala y lanza en el dispositivo conectado
npm run android:build   # APK / AAB de release
```

`ios:init` / `ios:dev` / `ios:build` son los mismos tres en macOS. Android necesita el SDK de Android
Studio (**Android 36** + platform-tools), un JDK 17+ y el NDK; iOS necesita Xcode. Ambos necesitan
los targets de Rust — `rustup target add aarch64-linux-android armv7-linux-androideabi
i686-linux-android x86_64-linux-android` y `aarch64-apple-ios aarch64-apple-ios-sim`.

### El plugin nativo propio de la wallet

El desbloqueo biométrico y la hoja de compartir son
**[src-tauri/plugins/cosmos](../src-tauri/plugins/cosmos)**, escrito para esta wallet en lugar de
tomado de un estante. No es preferencia: el contrato que necesita
[src/lib/deviceAuth.ts](../src/lib/deviceAuth.ts) es una clave cuya lectura **es** en sí misma una
comprobación biométrica en vivo — no una comprobación seguida de una lectura — y necesita que la
clave se destruya cuando cambia el conjunto biométrico. El plugin al que sustituye podía escribir
ese binding pero no volver a leerlo, así que el flag tenía que quedarse apagado.

Tener las dos mitades es lo que lo hace posible: Android acuña la clave con
`setUserAuthenticationRequired(true)`, una política de autenticación **por uso**,
`setUnlockedDeviceRequired(true)` y `setInvalidatedByBiometricEnrollment(true)`, y la abre a través
de un `CryptoObject` de `BiometricPrompt`; iOS la guarda `.biometryCurrentSet` bajo
`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`, donde `SecItemCopyMatching` levanta la hoja por sí
mismo. Ninguna de las dos tiene una ruta de código que lea la clave sin prompt.

Un mismo vocabulario abarca cuatro lenguajes (TypeScript, Rust, Kotlin, Swift) y ningún toolchain
comprueba que las cuatro listas coincidan — renombra una variante y todo sigue compilando, mientras
que un prompt cancelado empieza a llegar como una línea de error roja.
`tests/unit/nativeContract.test.ts` lee los cuatro archivos y los compara.

**Nota de migración.** Una inscripción hecha antes de que existiera este plugin vive en un espacio de
nombres del almacén seguro que este no mira, así que todo móvil que tuviera desbloqueo biométrico
aterriza una vez en "no inscrito" y lo vuelve a activar en Ajustes. La contraseña funciona en todo
momento. Rechazar en vez de migrar es deliberado — ver `DeviceAuthBinding` en
[src/lib/deviceAuth.ts](../src/lib/deviceAuth.ts).

### Icono de launcher y splash

`src-tauri/gen/` es una **salida** de Tauri: `tauri android init` la reescribe desde sus propias
plantillas, así que lo que se edite directamente ahí sobrevive hasta el siguiente init y entonces
desaparece. Los assets reales viven en `resources/android/`, versionado, y
[scripts/android-res.ts](../scripts/android-res.ts) los copia de vuelta — que es lo que ejecuta
`npm run android:init` después del generador.

```bash
npm run android:icons   # regenera resources/android/ desde public/logo-white.png
```

[scripts/android-icons.ts](../scripts/android-icons.ts) dibuja la marca blanca sobre `#080808` — el
mismo `--bg` con el que abre la app. Emite el par adaptativo (108dp, con el inset hasta los 72dp que
el launcher garantiza), iconos planos **opacos** para API < 26 y para las vistas previas que caen en
ellos, un `ic_launcher_round` circular y la escalera de splash. Un icono plano blanco sobre
transparente es invisible contra una superficie clara, y eso es lo que parece "el icono no se
aplicó". El juego de escritorio es aparte y sale de
[scripts/desktop-icon.ts](../scripts/desktop-icon.ts) más `tauri icon`, por la misma razón: un master
opaco, porque ningún launcher de escritorio aplica inset al arte antes de dibujarla.

### Permisos

Mismo problema que el icono, con consecuencias más agudas: el manifest generado declara INTERNET y
nada más, así que la cámara que abre el escáner QR se rechaza *sin prompt* — Android deniega una
petición en tiempo de ejecución de un permiso que el manifest nunca declaró. `npm run native:perms`
([scripts/native-permissions.ts](../scripts/native-permissions.ts)) repone las declaraciones y no
hace nada cuando ya están.

| Declaración | Por qué |
| --- | --- |
| `android.permission.CAMERA` | `getUserMedia` en [src/features/extras/ScanQR.tsx](../src/features/extras/ScanQR.tsx). La WebView levanta el prompt; el manifest es lo que hace posible el prompt. |
| `android.permission.USE_BIOMETRIC` | `BiometricPrompt` se niega a mostrarse sin él. También lo declara el manifest del plugin — el merger deduplica, así que ninguna de las dos declaraciones carga sola con el peso. |
| `uses-feature camera`, `camera.autofocus`, `fingerprint`, `required="false"` | Play lee esos permisos como *exigencia* de hardware y oculta la ficha a los dispositivos que no lo tienen. Ambas funciones tienen alternativa, así que ninguna es obligatoria. |
| `<queries>` ACTION_IMAGE_CAPTURE | Visibilidad de paquetes, API 30+. Sin ella `<input capture>` en el paso KYC no resuelve ninguna app de cámara y se convierte en silencio en un selector de galería. |
| `NSCameraUsageDescription`, `NSFaceIDUsageDescription`, `NSPhotoLibraryUsageDescription` | iOS, cuando la plataforma está generada. Ahí una purpose string ausente es un crash, no una denegación. |

No se concede nada en tiempo de compilación — al usuario se le sigue preguntando, una vez, al primer
uso. El escáner clasifica el rechazo ([src/lib/camera.ts](../src/lib/camera.ts)) en vez de culpar a
los permisos de cualquier fallo: sin cámara en el dispositivo, cámara tomada por otra app, y una
WebView servida por `http` plano (donde `navigator.mediaDevices` no existe) dicen cada una lo que
pasó de verdad.

El mismo script desactiva Android Auto Backup, para que la bóveda cifrada no llegue nunca a Google
Drive, e imprime la mitad de iOS que **no** puede arreglar: el archivo del store sigue siendo
elegible para iCloud, y cerrar eso necesita `NSURLIsExcludedFromBackupKey` puesto en un dispositivo
que aquí nadie puede probar. Lo dice en cada ejecución en vez de adivinar.

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
