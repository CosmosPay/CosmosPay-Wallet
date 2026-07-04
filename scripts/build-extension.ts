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
const baseHtml = await externaliseInlineScripts(htmlPath);

// Full visual effects stay ON in the extension (glass, blobs, glow, hover, popIn).
// The old "lite" downgrade is gone: the popup crash was traced (step-by-step bisect)
// to navigator.registerProtocolHandler running in the store boot — not the GPU —
// and that call is now web-only (see store.ts registerStellarHandler).
//
// popup sizing: a fixed, comfortable frame for the browser action popup.
// --shell-h pins the app's full-height layout to a determinate 600px instead of
// 100vh — an auto-sizing MV3 popup + a viewport-relative height makes Chrome kill
// the renderer for a bad IPC message (reason 219 → "se ha bloqueado"). That one is
// a real MV3 popup bug (unrelated to effects), so the fixed frame stays.
const popupStyle =
  '<style>html,body{width:400px;height:600px;overflow:hidden}:root{--shell-h:600px}</style>';
await writeFile(htmlPath, baseHtml.replace('</head>', `${popupStyle}</head>`), 'utf8');

// Side panel (Chrome) / sidebar (Firefox): same app, but the panel is a real,
// user-resizable viewport — full width/height instead of the popup's fixed frame.
// 100vh is safe here (only the auto-sizing action popup has the IPC issue above).
// --frame-max:100% makes the app column FILL the panel (no black gutters): the
// default caps it at 440px and centres it, which reads as wasted space in a
// sidebar. !important outranks the ≥680px media queries in the bundled CSS.
const sidepanelStyle =
  '<style>html,body{width:100%;height:100vh;overflow:hidden}:root{--shell-h:100vh;--frame-max:100% !important}</style>';
await writeFile(join(OUT, 'sidepanel.html'), baseHtml.replace('</head>', `${sidepanelStyle}</head>`), 'utf8');

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
  // sidePanel (Chrome-only permission): the wallet as a persistent side panel.
  permissions: ['storage', ...(TARGET === 'chrome' ? ['sidePanel'] : [])],
  // Address bar: `pay <web+stellar:…>` hands a SEP-7 link straight to the wallet.
  omnibox: { keyword: 'pay' },
  // Sidebar mode — same app at full viewport (sidepanel.html). Chrome exposes it in
  // the side-panel picker / action context menu; Firefox under View → Sidebar.
  ...(TARGET === 'chrome' ? { side_panel: { default_path: 'sidepanel.html' } } : {}),
  ...(TARGET === 'firefox'
    ? {
        sidebar_action: {
          default_panel: 'sidepanel.html',
          default_title: 'Cosmos Wallet',
          default_icon: 'icons/icon-48.png',
          open_at_install: false,
        },
      }
    : {}),
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
      // `https:` (any TLS host) on top of the defaults: the wallet supports custom
      // networks (own Horizon) and developer-mode endpoint overrides — both need to
      // reach user-configured servers. Scripts remain locked to 'self'.
      "connect-src 'self' https: https://horizon.stellar.org https://horizon-testnet.stellar.org https://friendbot.stellar.org https://api.coingecko.com",
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
