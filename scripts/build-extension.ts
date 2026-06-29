/**
 * Turn the built dist/ into an MV3 browser extension in extension/.
 *
 *   npm run build:ext   (= astro build && node ... build-extension.ts)
 *
 * Then load extension/ as an "unpacked extension" in Chrome/Edge
 * (chrome://extensions -> Developer mode -> Load unpacked) or Firefox
 * (about:debugging -> Load Temporary Add-on -> pick manifest.json).
 *
 * Why a post-build step? Astro inlines two tiny <script> blocks (its island
 * bootstrap). MV3's `script-src 'self'` forbids inline scripts, so we extract
 * them into external files and point <script src> at them — keeping the popup
 * CSP-compliant while behaving identically.
 */
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const OUT = 'extension';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(DIST))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// fresh copy of the build
await rm(OUT, { recursive: true, force: true });
await cp(DIST, OUT, { recursive: true });

// externalise inline <script> blocks (MV3 CSP forbids inline scripts)
const htmlPath = join(OUT, 'index.html');
let html = await readFile(htmlPath, 'utf8');
await mkdir(join(OUT, '_astro'), { recursive: true });

let n = 0;
const writes: Promise<void>[] = [];
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_m: string, code: string) => {
  const file = `inline-${n++}.js`;
  // write synchronously-ish via a side queue
  writes.push(writeFile(join(OUT, '_astro', file), code, 'utf8'));
  return `<script src="/_astro/${file}"></script>`;
});

// popup sizing: a fixed, comfortable frame for the browser action popup
const popupStyle =
  '<style>html,body{width:400px;height:600px;overflow:hidden}</style>';
html = html.replace('</head>', `${popupStyle}</head>`);

await Promise.all(writes);
await writeFile(htmlPath, html, 'utf8');

// minimal background service worker (lets tooling resolve the extension id;
// reserved for future background tasks — currently a no-op)
await writeFile(join(OUT, 'sw.js'), '// Cosmos Wallet — reserved background worker\n', 'utf8');

// MV3 manifest
const manifest = {
  manifest_version: 3,
  name: 'Cosmos · Stellar Wallet',
  version: '1.0.0',
  description: 'Wallet no custodial de Stellar. Tus claves, tus criptos, en tu navegador.',
  action: {
    default_popup: 'index.html',
    default_title: 'Cosmos Wallet',
    default_icon: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
  },
  icons: { '16': 'icons/icon-16.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' },
  background: { service_worker: 'sw.js' },
  host_permissions: [
    'https://horizon.stellar.org/*',
    'https://horizon-testnet.stellar.org/*',
    'https://friendbot.stellar.org/*',
    'https://api.coingecko.com/*',
  ],
  content_security_policy: {
    extension_pages: [
      "script-src 'self'",
      "object-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://horizon.stellar.org https://horizon-testnet.stellar.org https://friendbot.stellar.org https://api.coingecko.com",
    ].join('; '),
  },
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`✓ extension/ ready (${n} inline scripts externalised). Load it as an unpacked extension.`);
