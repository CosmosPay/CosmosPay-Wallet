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
 *
 * Note: bundled assets live in `assets/` (not the default `_astro/`) because MV3
 * reserves any name starting with `_`. That rename is configured in astro.config.ts.
 */
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
// Target: `chrome` (default) -> extension/ ; `firefox` -> extension-firefox/.
// Chrome and Firefox need different manifests (background service_worker vs event-page
// scripts; protocol_handlers is Firefox-only), so we emit one folder per target to
// avoid the "unrecognised key" warnings Chrome shows on Firefox-only keys.
const TARGET = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const OUT = TARGET === 'firefox' ? 'extension-firefox' : 'extension';

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

await mkdir(join(OUT, 'assets'), { recursive: true });

// externalise inline <script> blocks (MV3 CSP forbids inline scripts). Applied to
// every extension HTML page: the popup (index.html) and the dapp-approval window.
let n = 0;
async function externaliseInlineScripts(pagePath: string): Promise<string> {
  let src = await readFile(pagePath, 'utf8');
  const jobs: Promise<void>[] = [];
  src = src.replace(/<script>([\s\S]*?)<\/script>/g, (_m: string, code: string) => {
    const file = `inline-${n++}.js`;
    jobs.push(writeFile(join(OUT, 'assets', file), code, 'utf8'));
    return `<script src="/assets/${file}"></script>`;
  });
  await Promise.all(jobs);
  return src;
}

const htmlPath = join(OUT, 'index.html');
let html = await externaliseInlineScripts(htmlPath);

// GPU-safe rendering ("lite effects"). The MV3 popup renders on the user's real
// GPU in a tiny surface; stacking many `backdrop-filter: blur()` glass layers over
// three large animated `filter: blur(90px)` blobs can crash the renderer there —
// Chrome then shows "se ha bloqueado, haz clic para reiniciar la extensión".
//
// We (1) mark <html data-fx="lite"> statically so the rules below apply on the very
// first paint (before React mounts), and (2) inject the neutralising CSS HERE, in
// the post-build step, on purpose: Astro's CSS minifier (lightningcss) strips
// `backdrop-filter: none` from the bundled stylesheet, so the same rules placed in
// index.astro don't survive the build. Injected inline CSS is left untouched, and
// MV3's `style-src` allows 'unsafe-inline'. Web/native builds keep the full effects.
html = html.replace(/<html([^>]*)>/, '<html$1 data-fx="lite">');

const liteStyle =
  '<style>' +
  // frost is gone -> make the flat glass legible with a little more opacity
  '[data-fx="lite"]{--glass-bg:rgba(255,255,255,.12);--glass-soft-bg:rgba(255,255,255,.14);--surface:rgba(255,255,255,.1);--surface-2:rgba(255,255,255,.09);--nav-bg:rgba(12,12,12,.94)}' +
  '[data-fx="lite"][data-theme="light"]{--glass-bg:rgba(255,255,255,.82);--glass-soft-bg:rgba(255,255,255,.86);--surface:rgba(255,255,255,.78);--surface-2:rgba(255,255,255,.7);--nav-bg:rgba(236,238,241,.95)}' +
  // kill the two crash-prone ops: every backdrop blur + the big blurred blobs
  '[data-fx="lite"] *{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}' +
  '[data-fx="lite"] .cosmos-glow,[data-fx="lite"] .cosmos-blob-a,[data-fx="lite"] .cosmos-blob-b,[data-fx="lite"] .cosmos-blob-c{display:none !important}' +
  // stop the per-frame glass repaint loop (constant recompositing)
  '[data-fx="lite"] [style*="glassBreath"]{animation:none !important}' +
  // drop the entrance animations too (popIn/fadeUp run on every control on mount).
  // Continuous ambient animations (blobs/glow/glassBreath) are already gone above;
  // this keeps the popup's paint work minimal. The spinner (a <span>) is untouched.
  '[data-fx="lite"] button,[data-fx="lite"] input,[data-fx="lite"] textarea,[data-fx="lite"] select,[data-fx="lite"] .tap{animation:none !important}' +
  '</style>';

// popup sizing: a fixed, comfortable frame for the browser action popup.
// --shell-h pins the app's full-height layout to a determinate 600px instead of
// 100vh — an auto-sizing MV3 popup + a viewport-relative height makes Chrome kill
// the renderer for a bad IPC message (reason 219 → "se ha bloqueado").
const popupStyle =
  '<style>html,body{width:400px;height:600px;overflow:hidden}:root{--shell-h:600px}</style>';
html = html.replace('</head>', `${liteStyle}${popupStyle}</head>`);

await writeFile(htmlPath, html, 'utf8');

// Dapp-approval window (approve/index.html): same CSP externalisation, but none of
// the popup-only lite/sizing tweaks — it's a normal window with its own light styles.
const approvePath = join(OUT, 'approve', 'index.html');
if (await exists(approvePath)) {
  await writeFile(approvePath, await externaliseInlineScripts(approvePath), 'utf8');
}

// Provider plumbing: page-injected provider (window.cosmosWallet) + content-script
// bridge + background service worker. Copied verbatim from extension-src/.
for (const f of ['inpage.js', 'content.js', 'sw.js']) {
  await cp(join('extension-src', f), join(OUT, f));
}

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
  // Chrome uses `service_worker`; Firefox (MV3) uses an event-page `scripts` list.
  background: TARGET === 'firefox' ? { scripts: ['sw.js'] } : { service_worker: 'sw.js' },
  // storage: SW <-> approval-window public "mirror" (address + network + approved origins).
  permissions: ['storage'],
  // Address bar: `pay <web+stellar:…>` hands a SEP-7 link straight to the wallet.
  omnibox: { keyword: 'pay' },
  host_permissions: [
    'https://horizon.stellar.org/*',
    'https://horizon-testnet.stellar.org/*',
    'https://friendbot.stellar.org/*',
    'https://api.coingecko.com/*',
  ],
  // Inject the provider bridge into every web page so dapps can find window.cosmosWallet.
  content_scripts: [
    { matches: ['http://*/*', 'https://*/*'], js: ['content.js'], run_at: 'document_start', all_frames: false },
  ],
  // inpage.js is fetched by the content script and injected into the page's MAIN world.
  web_accessible_resources: [{ resources: ['inpage.js'], matches: ['http://*/*', 'https://*/*'] }],
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
  // Firefox-only keys. On Chrome these trigger "unrecognised key" warnings and
  // protocol_handlers needs a non-stable channel — so we add them ONLY to the
  // Firefox build. Registers the web+stellar: (SEP-7) handler -> index.html?uri=…,
  // which the app already reads (readIncomingSep7).
  ...(TARGET === 'firefox'
    ? {
        protocol_handlers: [{ protocol: 'web+stellar', name: 'Cosmos Wallet', uriTemplate: 'index.html?uri=%s' }],
        browser_specific_settings: { gecko: { id: 'cosmos-wallet@cosmospay.app', strict_min_version: '121.0' } },
      }
    : {}),
};
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`✓ ${OUT}/ ready [${TARGET}] (${n} inline scripts externalised, provider + approval window wired). Load it as an unpacked extension.`);
