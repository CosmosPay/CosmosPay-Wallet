import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

// https://astro.build/config
export default defineConfig({
  // Static output -> produces dist/ that Capacitor wraps into the native app.
  output: 'static',
  integrations: [react()],
  // Mobile-first: no trailing-slash surprises inside the WebView.
  trailingSlash: 'ignore',
  vite: {
    resolve: {
      // `@` -> src so modules can import `@/lib/...` instead of `../../lib/...`.
      // Existing relative (`../..`) imports keep working — both resolve to the same files.
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      // The Stellar SDK + bip39 expect Node's Buffer / global / process.
      // protocolImports:false avoids hijacking Vite's own `node:` imports.
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
        protocolImports: false,
      }),
    ],
    build: {
      // A single WebView app: a slightly larger chunk is fine, avoid noisy warnings.
      chunkSizeWarningLimit: 1500,
    },
  },
});
