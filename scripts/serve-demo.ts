/**
 * Static server for the dapp demo (demo/), so the content script (http match)
 * injects window.cosmosWallet.
 *
 *   npm run demo   ->  http://127.0.0.1:4399/dapp-demo.html
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'demo');
const PORT = Number(process.env.PORT) || 4399;
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p.endsWith('/')) p += 'dapp-demo.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`dapp demo en http://127.0.0.1:${PORT}/dapp-demo.html`));
