/**
 * WalletConnect's wallet-side rules (`src/lib/walletConnect.ts`): what a pairing URI must be,
 * what a session is offered, how the Verify verdict reads, which requests may reach the approval
 * — and that every build's CSP admits the relay the SDK talks to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WC_EVENTS, WC_METHODS, WC_RELAY_ORIGINS } from '@/constants/walletConnect';
import { evmDappChains } from '@/lib/evmDapp';
import {
  WC_ERR,
  chainIdOf,
  offeredChains,
  parseWcUri,
  wcBindingCurrent,
  wcChains,
  wcProposalProblem,
  wcRouteRequest,
  wcSupported,
  wcSwitchTarget,
  wcVerifyState,
} from '@/lib/walletConnect';

const ROOT = join(import.meta.dirname, '..', '..');
const TOPIC = 'a'.repeat(64);
const KEY = 'b'.repeat(64);
const NOW = Date.UTC(2026, 10, 11);
const ME = '0x6b30c7d7657A83141186Cd8c155CDB90C8750371';
const OTHER = '0x1111111111111111111111111111111111111111';

test('a v2 pairing URI is read whole; anything else is refused', () => {
  const uri = `wc:${TOPIC}@2?relay-protocol=irn&symKey=${KEY}`;
  assert.deepEqual(parseWcUri(uri, NOW), { uri, topic: TOPIC, symKey: KEY, expiry: null });
  assert.equal(parseWcUri(`  ${uri}\n`, NOW)?.uri, uri);
  assert.equal(parseWcUri(uri.toUpperCase().replace('WC:', 'wc:').replace('@2?RELAY-PROTOCOL=IRN&SYMKEY=', '@2?relay-protocol=irn&symKey='), NOW)?.topic, TOPIC);
  const future = Math.floor(NOW / 1000) + 300;
  assert.equal(parseWcUri(`${uri}&expiryTimestamp=${future}`, NOW)?.expiry, future);
  // v1, a missing or short key, two keys, another relay, an expired one, no query at all.
  assert.equal(parseWcUri(`wc:${TOPIC}@1?bridge=https%3A%2F%2Fb.example&key=${KEY}`, NOW), null);
  assert.equal(parseWcUri(`wc:${TOPIC}@2?relay-protocol=irn`, NOW), null);
  assert.equal(parseWcUri(`wc:${TOPIC}@2?relay-protocol=irn&symKey=${KEY.slice(2)}`, NOW), null);
  assert.equal(parseWcUri(`${uri}&symKey=${'c'.repeat(64)}`, NOW), null);
  assert.equal(parseWcUri(`wc:${TOPIC}@2?relay-protocol=waku&symKey=${KEY}`, NOW), null);
  assert.equal(parseWcUri(`${uri}&expiryTimestamp=${Math.floor(NOW / 1000) - 1}`, NOW), null);
  assert.equal(parseWcUri(`${uri}&expiryTimestamp=soon`, NOW), null);
  assert.equal(parseWcUri(`wc:${TOPIC.slice(1)}@2?relay-protocol=irn&symKey=${KEY}`, NOW), null);
  assert.equal(parseWcUri('web+stellar:pay?destination=G…', NOW), null);
  assert.equal(parseWcUri('', NOW), null);
  assert.equal(parseWcUri(`${uri}&x=${'y'.repeat(3000)}`, NOW), null);
});

test('a link carrying a pairing URI in `uri` is read once, never recursively', () => {
  const uri = `wc:${TOPIC}@2?relay-protocol=irn&symKey=${KEY}`;
  assert.equal(parseWcUri(`https://wallet.example/wc?uri=${encodeURIComponent(uri)}`, NOW)?.uri, uri);
  const nested = `https://a.example/?uri=${encodeURIComponent(`https://b.example/?uri=${encodeURIComponent(uri)}`)}`;
  assert.equal(parseWcUri(nested, NOW), null);
  assert.equal(parseWcUri('https://wallet.example/wc?uri=nothing', NOW), null);
});

test('a session is offered the EVM chains the wallet signs on in the mode, for its account', () => {
  for (const env of ['mainnet', 'testnet'] as const) {
    const chains = evmDappChains(env).map((c) => `eip155:${c.chainId}`);
    assert.deepEqual(wcChains(env), chains);
    const s = wcSupported(env, ME);
    assert.deepEqual(s.chains, chains);
    assert.deepEqual(s.accounts, chains.map((c) => `${c}:${ME}`));
    assert.deepEqual(s.methods, [...WC_METHODS]);
    assert.deepEqual(s.events, [...WC_EVENTS]);
  }
  // The modes never share a chain: a session approved in one cannot be used in the other.
  const main = new Set(wcChains('mainnet'));
  assert.ok(wcChains('testnet').every((c) => !main.has(c)));
  assert.ok(wcChains('mainnet').includes('eip155:42161'));
  assert.ok(wcChains('testnet').includes('eip155:421614'));
  assert.equal(chainIdOf('eip155:8453'), 8453);
  assert.equal(chainIdOf('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), null);
  assert.equal(chainIdOf('eip155:0x1'), null);
});

test('a proposal is refused when what it REQUIRES cannot be honoured; optional extras are dropped', () => {
  const ok = { eip155: { chains: ['eip155:1'], methods: ['eth_sendTransaction', 'personal_sign'], events: ['chainChanged'] } };
  assert.equal(wcProposalProblem(ok, undefined, 'mainnet', ME), null);
  assert.equal(wcProposalProblem({ 'eip155:42161': { methods: ['personal_sign'], events: [] } }, undefined, 'mainnet', ME), null);
  assert.equal(wcProposalProblem({ solana: { chains: ['solana:x'], methods: [], events: [] } }, undefined, 'mainnet', ME), 'namespace');
  assert.equal(wcProposalProblem({ eip155: { chains: ['eip155:130'], methods: [], events: [] } }, undefined, 'mainnet', ME), 'chains');
  assert.equal(wcProposalProblem(ok, undefined, 'testnet', ME), 'chains');
  assert.equal(wcProposalProblem({ eip155: { chains: ['eip155:1'], methods: ['eth_sign'], events: [] } }, undefined, 'mainnet', ME), 'methods');
  assert.equal(wcProposalProblem({ eip155: { chains: ['eip155:1'], methods: [], events: ['message'] } }, undefined, 'mainnet', ME), 'events');
  assert.equal(wcProposalProblem(ok, undefined, 'mainnet', null), 'account');
  // AppKit sends everything as optional: one chain of ours is enough; none is a refusal.
  const optional = { eip155: { chains: ['eip155:130', 'eip155:8453', 'eip155:42161'], methods: ['eth_sign', 'personal_sign'], events: ['message'] }, solana: { chains: ['solana:x'] } };
  assert.equal(wcProposalProblem({}, optional, 'mainnet', ME), null);
  assert.deepEqual(offeredChains({}, optional, 'mainnet').sort((a, b) => a - b), [8453, 42161]);
  assert.equal(wcProposalProblem({}, { eip155: { chains: ['eip155:130'] } }, 'mainnet', ME), 'chains');
});

test('the Verify verdict reads a flagged scam first, then the domain match', () => {
  assert.equal(wcVerifyState({ verified: { validation: 'VALID', isScam: true } }), 'threat');
  assert.equal(wcVerifyState({ verified: { validation: 'VALID' } }), 'match');
  assert.equal(wcVerifyState({ verified: { validation: 'INVALID', isScam: false } }), 'mismatch');
  assert.equal(wcVerifyState({ verified: { validation: 'UNKNOWN' } }), 'unknown');
  assert.equal(wcVerifyState(undefined), 'unknown');
  assert.equal(wcVerifyState({}), 'unknown');
});

const session = (account: string, chains = ['eip155:1', 'eip155:42161'], methods: string[] = [...WC_METHODS]) => ({
  namespaces: { eip155: { chains, methods, events: [...WC_EVENTS], accounts: chains.map((c) => `${c}:${account}`) } },
});

test('a request reaches the approval only for a chain, account and method the session and the wallet both hold', () => {
  const s = session(ME);
  const ok = wcRouteRequest(s, 'eip155:42161', 'eth_sendTransaction', [{}], 'mainnet', ME);
  assert.deepEqual(ok, { ok: true, chainId: 42161, method: 'eth_sendTransaction', params: [{}], sign: true });
  // The account compares without case: the session spells it as approved.
  assert.equal(wcRouteRequest(s, 'eip155:1', 'personal_sign', [], 'mainnet', ME.toLowerCase()).ok, true);
  // eth_signTypedData is read as v4.
  const typed = wcRouteRequest(s, 'eip155:1', 'eth_signTypedData', [], 'mainnet', ME);
  assert.equal(typed.ok && typed.method, 'eth_signTypedData_v4');
  const sw = wcRouteRequest(s, 'eip155:1', 'wallet_switchEthereumChain', [], 'mainnet', ME);
  assert.equal(sw.ok && sw.sign, false);

  const refused = (r: ReturnType<typeof wcRouteRequest>) => (r.ok ? null : r.error.code);
  // Another mode: the chain is not the wallet's now.
  assert.equal(refused(wcRouteRequest(s, 'eip155:1', 'personal_sign', [], 'testnet', ME)), WC_ERR.unsupportedChains.code);
  // A chain the wallet does not have, or not a CAIP-2 EVM chain at all.
  assert.equal(refused(wcRouteRequest(s, 'eip155:130', 'personal_sign', [], 'mainnet', ME)), WC_ERR.unsupportedChains.code);
  assert.equal(refused(wcRouteRequest(s, 'solana:x', 'personal_sign', [], 'mainnet', ME)), WC_ERR.unsupportedChains.code);
  // Approved for another wallet's account: never signs for the one active now.
  assert.equal(refused(wcRouteRequest(session(OTHER), 'eip155:1', 'personal_sign', [], 'mainnet', ME)), WC_ERR.unsupportedAccounts.code);
  assert.equal(refused(wcRouteRequest(s, 'eip155:1', 'personal_sign', [], 'mainnet', null)), WC_ERR.unsupportedAccounts.code);
  // A chain of ours the session does not hold.
  assert.equal(refused(wcRouteRequest(s, 'eip155:8453', 'personal_sign', [], 'mainnet', ME)), WC_ERR.unsupportedAccounts.code);
  // A method the wallet does not carry, or one the session was not approved for.
  assert.equal(refused(wcRouteRequest(s, 'eip155:1', 'eth_sign', [], 'mainnet', ME)), WC_ERR.unsupportedMethods.code);
  assert.equal(refused(wcRouteRequest(session(ME, ['eip155:1'], ['personal_sign']), 'eip155:1', 'eth_sendTransaction', [], 'mainnet', ME)), WC_ERR.unsupportedMethods.code);
});

test('a chain switch is answered only for a chain the session holds', () => {
  const s = session(ME);
  assert.deepEqual(wcSwitchTarget(s, [{ chainId: '0xa4b1' }], 'mainnet'), { chainId: 42161 });
  assert.ok('error' in wcSwitchTarget(s, [{ chainId: '0x2105' }], 'mainnet'));
  assert.ok('error' in wcSwitchTarget(s, [{ chainId: '0xa4b1' }], 'testnet'));
  assert.ok('error' in wcSwitchTarget(s, [], 'mainnet'));
});

test('a session binding holds for its wallet, mode and account only', () => {
  const b = { walletId: 'w1', env: 'mainnet' as const, account: ME };
  assert.equal(wcBindingCurrent(b, 'w1', 'mainnet', ME.toLowerCase()), true);
  assert.equal(wcBindingCurrent(b, 'w2', 'mainnet', ME), false);
  assert.equal(wcBindingCurrent(b, 'w1', 'testnet', ME), false);
  assert.equal(wcBindingCurrent(b, 'w1', 'mainnet', OTHER), false);
  assert.equal(wcBindingCurrent(undefined, 'w1', 'mainnet', ME), false);
});

test('every build that sends a CSP admits the relay', () => {
  const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { app: { security: { csp: Record<string, string> } } };
  const connect = tauri.app.security.csp['connect-src'].split(/\s+/);
  for (const origin of WC_RELAY_ORIGINS) assert.ok(connect.includes(origin), `tauri.conf.json connect-src lacks ${origin}`);
  const ext = readFileSync(join(ROOT, 'scripts', 'build-extension.ts'), 'utf8');
  assert.match(ext, /connect-src 'self' https: \$\{WC_RELAY_ORIGINS\.join\(' '\)\}/);
});
