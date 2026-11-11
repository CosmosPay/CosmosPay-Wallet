/**
 * WalletConnect end to end over the PUBLIC relay, with Cosmos's project id: a minimal site (the
 * Sign client, in Node) pairs with the wallet running in Chromium (a dev server and the debug
 * session), and asks for a personal_sign (recovered to the session's account), a typed-data
 * signature behind the acknowledgement, and one the person rejects. Nothing is sent to any
 * network but the relay. Needs a dev server: `npm run dev`, then
 *
 *   E2E_URL=http://localhost:4321/ npm run test:e2e:walletconnect [-- <screenshot dir>]
 */
import { SignClient } from '@walletconnect/sign-client';
import { chromium } from 'playwright';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { WC_DEFAULT_PROJECT_ID } from '@/constants/walletConnect';

const walletUrl = process.env.E2E_URL || 'http://localhost:4321/';
const shots = process.argv[2];
const PROJECT_ID = process.env.PUBLIC_WALLETCONNECT_PROJECT_ID || WC_DEFAULT_PROJECT_ID;
const PASSWORD = 'debug-wallet-pass';
const results = [];
const ok = (c, m) => (results.push([!!c, m]), console.log(`${c ? '✓' : '✗'} ${m}`));
const hex = (b) => Buffer.from(b).toString('hex');
const enc = new TextEncoder();

function recoverAddress(digest, sigHex) {
  const s = sigHex.replace(/^0x/, '');
  const rs = Buffer.from(s.slice(0, 128), 'hex');
  let v = parseInt(s.slice(128, 130), 16);
  if (v >= 27) v -= 27;
  const sig = secp256k1.Signature.fromBytes(rs, 'compact').addRecoveryBit(v);
  const pub = sig.recoverPublicKey(digest).toBytes(false);
  return '0x' + hex(keccak_256(pub.slice(1))).slice(-40);
}

const site = await SignClient.init({
  projectId: PROJECT_ID,
  metadata: { name: 'Cosmos WC relay test', description: 'Test site', url: 'https://cosmospay.lat', icons: ['https://cosmospay.lat/wallet/logo-512.png'] },
});
ok(true, 'the test site reached the relay with the project id');

const { uri, approval } = await site.connect({
  optionalNamespaces: {
    eip155: {
      chains: ['eip155:421614', 'eip155:11155111'],
      methods: ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
      events: ['chainChanged', 'accountsChanged'],
    },
  },
});
ok(uri?.startsWith('wc:'), 'pairing URI created');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
await page.goto(walletUrl, { waitUntil: 'networkidle' });
async function jump(screen) {
  await page.getByRole('button', { name: 'Open the debug navigator' }).click();
  await page.getByLabel('Search a screen').fill(screen);
  await page.getByRole('button', { name: screen, exact: true }).click();
  await page.waitForTimeout(1500);
}
await jump('wc-pair');
await page.getByPlaceholder('wc:…').fill(uri);
await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

const dialog = page.locator('dialog[open]');
await dialog.waitFor({ timeout: 45_000 });
await page.waitForTimeout(1200);
if (shots) await page.screenshot({ path: `${shots}/real-1-proposal.png` });
ok(await dialog.getByText('Cosmos WC relay test').isVisible(), 'the proposal reached the wallet over the relay and names the site');
await dialog.locator('button.btn-primary').click();

const session = await approval();
const account = session.namespaces.eip155.accounts[0];
const address = account.split(':')[2];
ok(/^eip155:(421614|11155111):0x[0-9a-fA-F]{40}$/.test(account), `session approved for ${account}`);
ok(Object.keys(session.namespaces.eip155).length > 0 && session.namespaces.eip155.methods.includes('personal_sign'), 'session carries personal_sign');

async function approveRequest(shot, ack) {
  const sheet = page.locator('dialog[open]');
  await sheet.waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1000);
  if (shots) await page.screenshot({ path: `${shots}/${shot}.png` });
  if (ack) await sheet.locator('label.wc-ack').click();
  await sheet.locator('button.btn-primary').click();
  await page.waitForTimeout(1500);
  const pwd = page.locator('input[type=password]');
  await pwd.waitFor({ timeout: 15_000 });
  await pwd.click();
  await pwd.pressSequentially(PASSWORD);
  await page.locator('button.confirm-sign-submit').click();
}

// personal_sign
const message = 'Cosmos Wallet relay test ' + Date.now();
const msgHex = '0x' + hex(enc.encode(message));
const sigPromise = site.request({ topic: session.topic, chainId: 'eip155:421614', request: { method: 'personal_sign', params: [msgHex, address] } });
await approveRequest('real-2-personal-sign', false);
const sig = await sigPromise;
const prefix = enc.encode(`\x19Ethereum Signed Message:\n${enc.encode(message).length}`);
const digest = keccak_256(Buffer.concat([prefix, enc.encode(message)]));
ok(recoverAddress(digest, sig).toLowerCase() === address.toLowerCase(), 'personal_sign over the relay recovers to the session account');

// eth_signTypedData_v4 (needs the acknowledgement)
const typed = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Login: [{ name: 'nonce', type: 'string' }],
  },
  primaryType: 'Login',
  domain: { name: 'Relay test', chainId: 421614 },
  message: { nonce: 'n-' + Date.now() },
};
const typedPromise = site.request({ topic: session.topic, chainId: 'eip155:421614', request: { method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] } });
await approveRequest('real-3-typed', true);
const typedSig = await typedPromise;
ok(/^0x[0-9a-f]{130}$/i.test(typedSig), 'eth_signTypedData_v4 over the relay answered a signature');

// A rejection travels back as an error.
const rejPromise = site.request({ topic: session.topic, chainId: 'eip155:421614', request: { method: 'personal_sign', params: [msgHex, address] } }).then(
  () => 'resolved',
  (e) => e?.code ?? e?.message ?? 'rejected',
);
const sheet = page.locator('dialog[open]');
await sheet.waitFor({ timeout: 45_000 });
await sheet.getByRole('button', { name: /Reject/ }).click();
const rej = await rejPromise;
ok(rej !== 'resolved', `a rejection reaches the site (${rej})`);

await site.disconnect({ topic: session.topic, reason: { code: 6000, message: 'test done' } });
ok(true, 'disconnected');
if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter(([c]) => !c);
console.log(failed.length ? `${failed.length} failed` : 'all passed');
process.exit(failed.length ? 1 : 0);
