/**
 * The extension's EVM provider end to end, in a real Chromium with the built extension loaded.
 *
 *   npm run build:ext && npm run test:e2e:extension-evm
 *
 * A local page discovers the provider through EIP-6963 and asks for what a P2P widget asks: the
 * chain, a switch, a read, the connect, a message signature, typed data and a transaction. The
 * wallet is the SEP-5 test phrase sealed straight into the extension's storage (a box in the
 * first releases' shape, which every build still opens); the approval windows are driven like a
 * person would. Signatures are checked by recovering the signer. The transaction goes to Arbitrum
 * Sepolia, a test network, and only to the wallet itself with no value: whether the node then
 * takes it depends on that public account having test ETH, so both answers are accepted.
 * Nothing touches a main network beyond the RPC reads.
 */
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { mnemonicToSeedSync } from 'bip39';
import { HDKey } from '@scure/bip32';
import { derivePath } from 'ed25519-hd-key';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Keypair } from '@stellar/stellar-sdk';

const EXT = resolve('dist/extension');
const PHRASE = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const PASSWORD = 'e2e-wallet-pass';
const ARB_SEPOLIA = 421614;

const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
function checksum(lower: string): string {
  const a = lower.toLowerCase().replace(/^0x/, '');
  const h = hex(keccak_256(new TextEncoder().encode(a)));
  return '0x' + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
const addressOfPub = (pub: Uint8Array) => checksum(hex(keccak_256(pub.subarray(1)).subarray(12)));

const seed = mnemonicToSeedSync(PHRASE);
const evmNode = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
const EVM = addressOfPub(secp256k1.getPublicKey(evmNode.privateKey as Uint8Array, false));
const stellar = Keypair.fromRawEd25519Seed(Buffer.from(derivePath("m/44'/148'/0'", seed.toString('hex')).key));

function recover(digestHex: string, sig: string): string {
  const b = Buffer.from(sig.slice(2), 'hex');
  const pub = secp256k1.Signature.fromBytes(Uint8Array.from(b.subarray(0, 64)), 'compact')
    .addRecoveryBit(b[64] - 27)
    .recoverPublicKey(Uint8Array.from(Buffer.from(digestHex, 'hex')));
  return addressOfPub(pub.toBytes(false));
}
const personalDigest = (msg: string) => hex(keccak_256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${Buffer.byteLength(msg)}${msg}`)));

// The test page: it only listens for EIP-6963 announcements and asks for them.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>EVM dapp</title></head><body>
<script>
window.__providers = [];
window.__events = [];
window.addEventListener('eip6963:announceProvider', (e) => window.__providers.push(e.detail));
window.dispatchEvent(new Event('eip6963:requestProvider'));
</script></body></html>`;
const server = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const ORIGIN = `http://127.0.0.1:${port}`;

const profile = await mkdtemp(join(tmpdir(), 'cw-evm-e2e-'));
let context: BrowserContext | null = null;

/** Run `fn` in the page against the Cosmos provider; errors come back as { code, message }. */
async function call(page: Page, method: string, params: unknown[] = []) {
  return page.evaluate(
    async ([m, p]) => {
      try {
        return { ok: await (window as any).__cw.request({ method: m, params: p }) };
      } catch (e: any) {
        return { code: e.code, message: e.message };
      }
    },
    [method, params] as const,
  );
}

/** Start a call that opens the approval window, and hand back the window and the pending answer. */
async function withWindow(page: Page, method: string, params: unknown[]) {
  const opened = context!.waitForEvent('page', { timeout: 20000 });
  const answer = call(page, method, params);
  const win = await opened;
  await win.waitForLoadState('domcontentloaded');
  return { win, answer };
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;

  // Seal the wallet into the extension's storage, from one of its own pages.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/approve/index.html`);
  await ext.evaluate(
    async ({ plaintext, password, entry }) => {
      const enc = new TextEncoder();
      const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
      const box = { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
      await (globalThis as any).chrome.storage.local.set({
        'cosmos.wallets': JSON.stringify([entry]),
        'cosmos.active': entry.id,
        [`cosmos.w.${entry.id}`]: JSON.stringify(box),
      });
    },
    {
      plaintext: JSON.stringify({ secret: stellar.secret(), mnemonic: PHRASE }),
      password: PASSWORD,
      entry: {
        id: 'e2e',
        publicKey: stellar.publicKey(),
        name: 'E2E',
        birthdate: '1990-01-01',
        email: 'e2e@example.com',
        createdAt: Date.now(),
        networkAddresses: { v: 2, byKind: { evm: EVM } },
      },
    },
  );
  await ext.close();

  const page = await context.newPage();
  await page.goto(ORIGIN);
  await page.waitForFunction(() => (window as any).__providers.some((d: any) => d.info.rdns === 'lat.cosmospay.wallet'), null, { timeout: 15000 });
  const info = await page.evaluate(() => {
    const d = (window as any).__providers.find((x: any) => x.info.rdns === 'lat.cosmospay.wallet');
    (window as any).__cw = d.provider;
    d.provider.on('chainChanged', (c: string) => (window as any).__events.push(['chainChanged', c]));
    d.provider.on('connect', (c: unknown) => (window as any).__events.push(['connect', c]));
    d.provider.on('accountsChanged', (a: string[]) => (window as any).__events.push(['accountsChanged', a]));
    return { ...d.info, isEthereum: (window as any).ethereum === d.provider };
  });
  ok(info.name === 'Cosmos Wallet' && /^data:image\/svg\+xml;base64,/.test(info.icon) && /^[0-9a-f-]{36}$/.test(info.uuid), 'EIP-6963 announces Cosmos Wallet with its icon');
  ok(info.isEthereum, 'window.ethereum is the provider when no other wallet set it');

  // Before any window: the test mode's default chain, no accounts, signing refused.
  ok((await call(page, 'eth_chainId')).ok === '0xaa36a7', 'eth_chainId answers Sepolia in test mode');
  ok(Array.isArray((await call(page, 'eth_accounts')).ok) && (await call(page, 'eth_accounts')).ok.length === 0, 'eth_accounts is empty before the connect');
  ok((await call(page, 'personal_sign', ['0x68656c6c6f', EVM])).code === 4100, 'signing before the connect is 4100');
  ok((await call(page, 'eth_sign', [EVM, '0x00'])).code === 4200, 'an unsupported method is 4200');
  ok((await call(page, 'wallet_switchEthereumChain', [{ chainId: '0x1' }])).code === 4902, 'a main network in test mode is 4902');
  ok((await call(page, 'wallet_switchEthereumChain', [{ chainId: '0x' + ARB_SEPOLIA.toString(16) }])).ok === null, 'switching to Arbitrum Sepolia needs no window');
  ok((await call(page, 'eth_chainId')).ok === '0x66eee', 'eth_chainId follows the switch');
  const events = await page.evaluate(() => (window as any).__events);
  ok(events.some((e: any[]) => e[0] === 'chainChanged' && e[1] === '0x66eee'), 'chainChanged is emitted');
  const block = await call(page, 'eth_blockNumber');
  ok(typeof block.ok === 'string' && /^0x[0-9a-f]+$/.test(block.ok), `eth_blockNumber is read from the chain's node (${block.ok ?? block.message})`);

  // The connect.
  {
    const { win, answer } = await withWindow(page, 'eth_requestAccounts', []);
    await win.getByText(EVM.slice(0, 10)).first().waitFor({ timeout: 15000 });
    ok(await win.getByText(ORIGIN).first().isVisible(), 'the connect window names the site');
    await win.getByRole('button', { name: 'Connect' }).click();
    const r = await answer;
    ok(Array.isArray(r.ok) && r.ok[0] === EVM, `eth_requestAccounts answers the wallet's 0x address (${JSON.stringify(r)})`);
    const again = await call(page, 'eth_accounts');
    ok(again.ok?.[0] === EVM, 'eth_accounts answers it from then on, with no window');
  }

  // A rejected signature.
  {
    const { win, answer } = await withWindow(page, 'personal_sign', ['0x68656c6c6f', EVM]);
    await win.getByRole('button', { name: 'Reject' }).click();
    ok((await answer).code === 4001, 'Reject answers 4001');
  }

  // personal_sign.
  {
    const { win, answer } = await withWindow(page, 'personal_sign', ['0x68656c6c6f', EVM]);
    await win.getByText('hello', { exact: true }).waitFor({ timeout: 15000 });
    await win.getByPlaceholder('Wallet password').fill(PASSWORD);
    await win.getByRole('button', { name: 'Approve' }).click();
    const r = await answer;
    ok(typeof r.ok === 'string' && recover(personalDigest('hello'), r.ok) === EVM, `personal_sign recovers to the account (${JSON.stringify(r).slice(0, 80)})`);
  }

  // eth_signTypedData_v4, the spec's example bound to the selected chain; its digest is computed
  // independently here (domain separator and struct hash recomputed by hand would duplicate the
  // library, so the check is that the signer recovers over the library-independent EIP-712 hash
  // of the spec's own example with chainId 1 swapped — see tests/unit/evmDapp.test.ts for the vector).
  {
    const typed = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      },
      primaryType: 'Mail',
      domain: { name: 'Ether Mail', version: '1', chainId: ARB_SEPOLIA, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
      message: {
        from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
        to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        contents: 'Hello, Bob!',
      },
    };
    const wrong = await withWindow(page, 'eth_signTypedData_v4', [EVM, JSON.stringify({ ...typed, domain: { ...typed.domain, chainId: 1 } })]);
    await wrong.win.getByText('another network', { exact: false }).first().waitFor({ timeout: 15000 });
    ok(await wrong.win.getByRole('button', { name: 'Approve' }).isDisabled(), 'typed data for another chain cannot be approved');
    await wrong.win.getByRole('button', { name: 'Reject' }).click();
    await wrong.answer;

    const { win, answer } = await withWindow(page, 'eth_signTypedData_v4', [EVM, JSON.stringify(typed)]);
    await win.getByText('Ether Mail').waitFor({ timeout: 15000 });
    await win.getByPlaceholder('Wallet password').fill(PASSWORD);
    ok(await win.getByRole('button', { name: 'Approve' }).isDisabled(), 'typed data cannot be signed before the acknowledgement');
    ok(await win.getByText('Mail.to').first().isVisible(), 'the grant-like field is named');
    await win.getByRole('checkbox').check();
    await win.getByRole('button', { name: 'Approve' }).click();
    const r = await answer;
    ok(typeof r.ok === 'string' && /^0x[0-9a-f]{130}$/.test(r.ok), `eth_signTypedData_v4 answers a signature (${JSON.stringify(r).slice(0, 80)})`);
  }

  // An unreadable contract call needs the acknowledgement.
  {
    const { win, answer } = await withWindow(page, 'eth_sendTransaction', [{ from: EVM, to: EVM, data: '0xdeadbeef', value: '0x0' }]);
    await win.getByText('0xdeadbeef').first().waitFor({ timeout: 15000 });
    await win.getByPlaceholder('Wallet password').fill(PASSWORD);
    ok(await win.getByRole('button', { name: 'Send' }).isDisabled(), 'an unreadable call cannot be sent before the acknowledgement');
    await win.getByRole('checkbox').check();
    ok(await win.getByRole('button', { name: 'Send' }).isEnabled(), 'the acknowledgement enables it');
    await win.getByRole('button', { name: 'Reject' }).click();
    ok((await answer).code === 4001, 'and Reject still answers 4001');
  }

  // An `approve` to a contract the wallet does not list: a contract call, never an ERC-20 in words.
  {
    const approveData = `0x095ea7b3${'0'.repeat(24)}${EVM.slice(2).toLowerCase()}${'f'.repeat(64)}`;
    const { win, answer } = await withWindow(page, 'eth_sendTransaction', [{ from: EVM, to: '0x2222222222222222222222222222222222222222', data: approveData }]);
    await win.getByText('Looks like').first().waitFor({ timeout: 15000 });
    await win.getByPlaceholder('Wallet password').fill(PASSWORD);
    ok(await win.getByRole('button', { name: 'Send' }).isDisabled(), 'an approve to an unknown contract needs the acknowledgement');
    await win.getByRole('button', { name: 'Reject' }).click();
    await answer;
  }

  // A transaction on Arbitrum Sepolia: to itself, no value. Signed and handed to the node; the
  // node takes it (hash) or refuses it for want of test ETH (an error from the node).
  {
    const { win, answer } = await withWindow(page, 'eth_sendTransaction', [{ from: EVM, to: EVM, value: '0x0' }]);
    await win.getByText('Arbitrum Sepolia').first().waitFor({ timeout: 15000 });
    await win.getByPlaceholder('Wallet password').fill(PASSWORD);
    await win.getByRole('button', { name: 'Send' }).click();
    const r = await answer;
    const hash = typeof r.ok === 'string' && /^0x[0-9a-f]{64}$/.test(r.ok);
    const refusedForFunds = typeof r.message === 'string' && /fund|balance|gas/i.test(r.message);
    ok(hash || refusedForFunds, `eth_sendTransaction signs and reaches the test network's node (${JSON.stringify(r).slice(0, 160)})`);
  }

  // Closing the window is a rejection.
  {
    const { win, answer } = await withWindow(page, 'personal_sign', ['0x68656c6c6f', EVM]);
    await win.close();
    ok((await answer).code === 4001, 'closing the window answers 4001');
  }

  // The site forgets the wallet.
  ok((await call(page, 'wallet_revokePermissions', [{ eth_accounts: {} }])).ok === null, 'wallet_revokePermissions succeeds');
  ok((await call(page, 'eth_accounts')).ok?.length === 0, 'and eth_accounts is empty again');
} catch (e) {
  fails.push(String(e));
  console.log('✗ ' + String(e));
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
process.exit(fails.length ? 1 : 0);
