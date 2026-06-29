# 🎬 Cosmos Pay — Video demo (Remotion)

Video walkthrough vertical (1080×1920, 30 fps, **~74 s**) del flujo completo de la
wallet **Cosmos Pay**, generado con [Remotion](https://www.remotion.dev/).

El video recorre las 15 pantallas reales de la app — desde el onboarding
(frase de recuperación, verificación, datos personales, contraseña) hasta el
home, el fondeo en Testnet y las acciones de Recibir / Enviar / Intercambiar /
Mercados / Ganar / Perfil.

> **Resultado renderizado:** [`cosmos-pay-demo.mp4`](./cosmos-pay-demo.mp4) (H.264, faststart, ~14 MB)

## Cómo está hecho

1. **Capturas reales.** Un driver de Playwright (`scripts/capture-screens.mjs`)
   levanta el `npm run dev` de la wallet, recorre el flujo de punta a punta
   (creando una wallet real en Stellar Testnet y fondeándola con Friendbot) y
   guarda un screenshot limpio de cada pantalla en `public/shots/`.
2. **Composición Remotion.** Cada screenshot se monta dentro de un "teléfono"
   con marco glass, caption animado (título + subtítulo), efecto Ken Burns y
   cross-fades entre escenas. Fondo oscuro con blobs a la deriva que imitan el
   estilo de la app. Todo animado con `useCurrentFrame()` + `interpolate()`
   (sin CSS transitions, según las reglas de Remotion).

```
src/
  Root.tsx         # <Composition> 1080×1920, duración calculada
  Walkthrough.tsx  # escena raíz: fondo + secuencias + brand + barra de progreso
  Scene.tsx        # una pantalla: teléfono + caption + Ken Burns + cross-fade
  Background.tsx   # fondo ambiental animado (blobs + viñeta)
  scenes.ts        # guion: imagen + título + subtítulo de cada pantalla
public/
  shots/*.png      # 15 capturas reales de la app
  logo-white.png
```

## Desarrollo

```bash
npm install
npm run dev            # abre Remotion Studio para previsualizar
```

## Render

Remotion necesita un Chrome headless. Si la descarga falla por un proxy TLS,
pasá `--browser-executable` apuntando a un Chrome existente y
`NODE_OPTIONS=--use-system-ca`:

```bash
# render por defecto (descarga su propio Chrome)
npx remotion render CosmosWalkthrough out/cosmos-walkthrough.mp4

# con un Chrome ya instalado (ej. el de Playwright) y CA del sistema
NODE_OPTIONS=--use-system-ca npx remotion render CosmosWalkthrough \
  out/cosmos-walkthrough.mp4 \
  --browser-executable="<ruta a chrome-headless-shell.exe>"
```

Para comprimir a tamaño web:

```bash
npx remotion ffmpeg -i out/cosmos-walkthrough.mp4 -vcodec libx264 \
  -crf 24 -preset medium -pix_fmt yuv420p -movflags +faststart \
  cosmos-pay-demo.mp4
```

## Re-capturar las pantallas

Con la wallet corriendo (`npm run dev` en el proyecto raíz, en
`http://127.0.0.1:4321`):

```bash
# desde el proyecto de la wallet (usa su playwright)
OUT_DIR=../demo-video/public/shots node scripts/capture-screens.mjs
```
