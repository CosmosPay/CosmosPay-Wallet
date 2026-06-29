# 🚀 Cosmos Pay — Pitch del demo

> **Cosmos Pay** es una **wallet no custodial de Stellar**: tus claves se generan
> y se cifran en tu dispositivo, y nunca salen de él. Pensada como app móvil
> (Android / iOS vía Capacitor) y extensión de navegador, con una interfaz
> *glassmorphism* en 5 idiomas. **Tus claves, tus criptos — bajo tu control.**

---

## 🎯 El problema

Las wallets de cripto suelen obligar a elegir entre dos males:

- **Custodiales** (un tercero guarda tus claves) → cómodas, pero no son *tuyas*:
  si la plataforma cae o te congela la cuenta, perdés el acceso.
- **No custodiales** existentes → seguras, pero con una UX intimidante:
  frases sueltas, jerga técnica, cero onboarding guiado.

En Latinoamérica, donde la cripto es una herramienta real de ahorro y pagos,
esa fricción deja a mucha gente afuera.

## 💡 La solución

Cosmos Pay combina **auto-custodia real** con una **UX de app fintech**:

- Onboarding guiado paso a paso (crear o importar, respaldo verificado,
  contraseña fuerte) en menos de un minuto.
- Toda la criptografía es real y **local**: derivación **BIP-39 / SEP-5**,
  cifrado **AES-256-GCM** con clave **PBKDF2** (210k iteraciones).
- Operación real sobre **Stellar**: ver saldo, recibir (QR + SEP-7), enviar
  pagos firmados localmente, ver mercados en vivo, e intercambiar activos.
- Multi-wallet bajo una sola contraseña, multi-red (Testnet ⇄ Mainnet),
  multi-idioma y temas claro/oscuro.

---

## 🎬 Qué muestra el demo (`cosmos-pay-demo.mp4`, ~74 s)

El video recorre **el flujo real de la app**, capturado pantalla por pantalla
sobre Stellar **Testnet** (incluido un fondeo real con Friendbot).

| # | t (aprox.) | Pantalla | Qué demuestra |
|---|-----------|----------|----------------|
| 01 | 0:00 | **Bienvenida** | Auto-custodia en Stellar — crear o importar |
| 02 | 0:05 | **Frase de recuperación** | 12 palabras BIP-39 / SEP-5 generadas en el dispositivo |
| 03 | 0:10 | **Verificá tu frase** | El usuario reconstruye la frase: respaldo a prueba de olvidos |
| 04 | 0:15 | **Verificación correcta** | Las palabras coinciden — backup confirmado |
| 05 | 0:20 | **Sobre vos** | Nombre, correo y fecha — *guardados solo en tu dispositivo* |
| 06 | 0:25 | **Contraseña** | Sellado del vault con AES-256-GCM + PBKDF2 |
| 07 | 0:29 | **¡Wallet creada!** | Lista, cifrada y protegida |
| 08 | 0:34 | **Home / Portafolio** | Saldo, variación 24 h y acciones rápidas |
| 09 | 0:39 | **Fondeo Testnet** | 10.000 XLM de prueba reales vía Friendbot + precios live |
| 10 | 0:44 | **Recibir** | QR escaneable + dirección pública `G…` (SEP-7) |
| 11 | 0:49 | **Enviar** | Pago firmado localmente y enviado a la red |
| 12 | 0:54 | **Intercambiar** | Swap entre activos de Stellar |
| 13 | 0:59 | **Mercados** | Precios en vivo (XLM, USDC, EURC…) |
| 14 | 1:04 | **Ganar** | Ahorro y rendimiento sobre los fondos |
| 15 | 1:09 | **Perfil y ajustes** | Multi-wallet, red, idioma y tema |

> Nota: el paso **05 (“Sobre vos”)** es la única recolección de datos del flujo —
> nombre, correo y fecha de nacimiento, **opcionales para personalizar la app y
> guardados solo localmente**. No hay verificación de identidad (KYC) en la
> wallet: la auto-custodia no la requiere. Si el producto suma cash-in/out con
> ARS en el futuro, el KYC viviría en esa capa de anchor, no en la wallet.

---

## 🎙️ Guion narrado (~74 s, sincronizado al video)

> **[0:00]** Esto es Cosmos Pay: una wallet de Stellar donde *vos* tenés el control.
> Tus claves se generan y se cifran en tu teléfono, y nunca salen de ahí.
>
> **[0:05]** Al crear una wallet, generamos tu frase de recuperación de 12
> palabras en el dispositivo, con el estándar BIP-39 y la derivación SEP-5 de
> Stellar.
>
> **[0:10]** Para asegurarnos de que la guardaste, te pedimos que la reconstruyas.
> Sin respaldo no se avanza.
>
> **[0:20]** Te saludamos por tu nombre — son datos que viven solo en tu equipo.
>
> **[0:25]** Elegís una contraseña y sellamos todo con cifrado AES-256-GCM.
> **[0:29]** Listo: tu wallet está creada y protegida.
>
> **[0:34]** Este es tu portafolio. **[0:39]** En Testnet la fondeamos al instante
> con Friendbot y ya ves precios reales de mercado.
>
> **[0:44]** Podés **recibir** con un QR, **[0:49] enviar** pagos firmados
> localmente, **[0:54] intercambiar** activos, **[0:59]** seguir los **mercados**
> en vivo y **[1:04] ganar** rendimiento.
>
> **[1:09]** Todo configurable: varias wallets, redes, idiomas y temas.
> Cosmos Pay: tus claves, tus criptos — bajo tu control.

---

## 🧱 Tecnología

- **Astro 7 + React 19 (TSX)** · salida estática que empaqueta Capacitor / la extensión MV3
- **@stellar/stellar-sdk** · Horizon, transacciones, keypairs
- **bip39 + ed25519-hd-key** · mnemónico → semilla → **SEP-5** (verificado contra el vector oficial)
- **Web Crypto API** · PBKDF2 + AES-GCM (todo el cifrado, en el cliente)
- **Demo:** [Remotion](https://www.remotion.dev/) (composición React) + Playwright (captura del flujo real)

## 🔐 Por qué importa la auto-custodia

El servidor (Horizon) solo recibe transacciones **ya firmadas localmente**.
Ni la frase ni la clave secreta tocan la red. Contraseña equivocada → el tag de
autenticación GCM falla → acceso denegado. *No custodial de verdad.*

## 🗺️ Roadmap

- Swap on-chain real vía DEX (hoy en demo)
- Earn / staking con AMM de Stellar (hoy informativo)
- Capa de cash-in/out con ARS (T3.0) + anchor SEP-24 (ahí entraría el KYC)
- Publicación en stores y web stores de extensiones
