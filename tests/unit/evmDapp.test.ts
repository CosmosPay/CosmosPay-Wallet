/**
 * The EVM half of the dapp surface (`src/lib/evmDapp.ts`, `extension-src/sw.js`,
 * `extension-src/inpage.js`): what a site may ask of the 0x account, read before anything is
 * signed.
 *
 *   the chain table   the worker's copy (plain JS, no imports) equals the wallet's own
 *   the requests      anything that does not fit is a refusal, by key, never a guess
 *   the calldata      ERC-20 calls in words, the rest marked unreadable
 *   the digests       EIP-191 and EIP-712 against published vectors
 *   the fee cap       a network without one has no allowance at all
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  ERC20_FN_KEYS,
  EVM_APPROVE_TITLE_KEYS,
  EVM_DEFAULT_CHAIN,
  EVM_ERR,
  EVM_PROVIDER_NAME,
  EVM_PROVIDER_RDNS,
  EVM_READ_METHODS,
  EVM_SIGN_METHODS,
} from '@/constants/evmDapp';
import { NETWORKS } from '@/constants/networks';
import {
  EvmDappRefused,
  encodeType,
  evmDappChain,
  evmDappChains,
  feeWithinCap,
  formatUnits,
  hashStruct,
  isPermitLike,
  messagePreview,
  parseEvmDappRequest,
  parseTypedData,
  personalMessageBytes,
  personalSignDigest,
  reviewCall,
  signEvmDigest,
  typedDataDigest,
} from '@/lib/evmDapp';
import { bytesToHex, evmAddressOf } from '@/lib/evmTx';
import { T } from '@/lib/i18n';

const ROOT = join(import.meta.dirname, '..', '..');
const SW = readFileSync(join(ROOT, 'extension-src', 'sw.js'), 'utf8');
const INPAGE = readFileSync(join(ROOT, 'extension-src', 'inpage.js'), 'utf8');

/** The JSON literal between `/* <name>:begin *\/` and `/* <name>:end *\/` in sw.js. */
function swBlock(name: string): unknown {
  const m = new RegExp(`/\\* ${name}:begin \\*/\\s*const \\w+ = (.*?);\\s*/\\* ${name}:end \\*/`, 's').exec(SW);
  assert.ok(m, `sw.js has no ${name} block`);
  return JSON.parse(m[1]);
}

const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

const refusalKey = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof EvmDappRefused, `expected a refusal, got ${String(e)}`);
    return e.key;
  }
  assert.fail('expected a refusal');
};

/* ------------------------------------------------------------------ chains */

test('the worker’s chain table is the wallet’s own', () => {
  const ours = {
    mainnet: evmDappChains('mainnet').map(({ chainId, rpc }) => ({ chainId, rpc })),
    testnet: evmDappChains('testnet').map(({ chainId, rpc }) => ({ chainId, rpc })),
  };
  assert.deepEqual(swBlock('evm-chains'), ours, `paste into extension-src/sw.js:\nconst EVM_CHAINS = ${JSON.stringify(ours)};`);
});

test('the worker’s method lists, defaults and codes are the constants’', () => {
  assert.deepEqual(swBlock('evm-read'), [...EVM_READ_METHODS]);
  assert.deepEqual(swBlock('evm-sign'), [...EVM_SIGN_METHODS]);
  const defaults = /const EVM_DEFAULT_CHAIN = (\{[^}]*\});/.exec(SW);
  const codes = /const EVM_ERR = (\{[^}]*\});/.exec(SW);
  assert.ok(defaults && codes);
  // `{ a: 1, b: -2 }` read as JSON by quoting its keys: the literals hold numbers only.
  const literal = (s: string) => JSON.parse(s.replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(literal(defaults[1]), EVM_DEFAULT_CHAIN);
  assert.deepEqual(literal(codes[1]), { ...EVM_ERR });
});

test('each mode’s default chain is one of its chains, and only signing EVM networks are offered', () => {
  for (const env of ['mainnet', 'testnet'] as const) {
    assert.ok(evmDappChain(env, EVM_DEFAULT_CHAIN[env]), env);
    for (const c of evmDappChains(env)) assert.equal(NETWORKS[c.network].address, 'evm');
  }
  // Monad keeps its own path and has no cap here; Hyperliquid is not a chain.
  assert.equal(evmDappChain('mainnet', 143), null);
  assert.equal(evmDappChain('testnet', 1), null, 'a main network is never offered in test mode');
  assert.equal(evmDappChain('mainnet', 11155111), null, 'nor a test network on mainnet');
});

test('the worker routes the EVM namespace and is a text file', () => {
  assert.ok(!SW.includes('\u0000'), 'a NUL byte makes git treat sw.js as binary');
  assert.match(SW, /if \(method === EVM_METHOD\) return handleEvm\(/);
});

test('the provider announces itself as the constants say, and never takes window.ethereum', () => {
  assert.ok(INPAGE.includes(`rdns: '${EVM_PROVIDER_RDNS}'`));
  assert.ok(INPAGE.includes(`name: '${EVM_PROVIDER_NAME}'`));
  assert.ok(INPAGE.includes("'__COSMOS_WALLET_ICON__'"), 'scripts/build-extension.ts replaces this placeholder');
  assert.ok(readFileSync(join(ROOT, 'scripts', 'build-extension.ts'), 'utf8').includes('__COSMOS_WALLET_ICON__'));
  assert.match(INPAGE, /if \(window\.ethereum === undefined\)/);
});

/* ---------------------------------------------------------------- requests */

test('a transaction is read strictly', () => {
  const ok = parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, value: '0x0de0b6b3a7640000', data: '0xABCD', gas: '0x5208', chainId: '0xa4b1' }], 42161);
  assert.deepEqual(ok, { kind: 'sendTransaction', tx: { from: ME, to: OTHER, value: 10n ** 18n, data: '0xabcd', gas: 21000n } });
  // `input` is read like `data`; no value is zero.
  assert.deepEqual(parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, input: '0x' }], 1), {
    kind: 'sendTransaction',
    tx: { from: ME, to: OTHER, value: 0n, data: '0x', gas: null },
  });
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: ME, data: '0x60' }], 1)), 'approve.evm.err.create');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, chainId: '0x1' }], 42161)), 'approve.evm.err.txChain');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, value: '100' }], 1)), 'approve.evm.err.params');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, data: '0x12', input: '0x34' }], 1)), 'approve.evm.err.params');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: ME, to: OTHER, data: '0x123' }], 1)), 'approve.evm.err.params');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sendTransaction', [{ from: 'me', to: OTHER }], 1)), 'approve.evm.err.params');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_sign', [ME, '0x00'], 1)), 'approve.evm.err.method');
});

test('personal_sign takes either parameter order, and hex is bytes', () => {
  const a = parseEvmDappRequest('personal_sign', ['0x68656c6c6f', ME], 1);
  const b = parseEvmDappRequest('personal_sign', [ME, 'hello'], 1);
  assert.equal(a.kind, 'personalSign');
  assert.equal(b.kind, 'personalSign');
  if (a.kind !== 'personalSign' || b.kind !== 'personalSign') return;
  assert.equal(a.address, ME);
  assert.deepEqual(a.message, b.message);
  assert.deepEqual(messagePreview(personalMessageBytes('0x68656c6c6f')), { text: 'hello', hex: false });
  assert.deepEqual(messagePreview(personalMessageBytes('0xff00')), { text: '0xff00', hex: true });
  // A control character hides what is signed: shown as hex.
  assert.equal(messagePreview(utf8ToBytes('a\u0007b')).hex, true);
});

/* --------------------------------------------------------------- calldata */

test('ERC-20 calls are put in words, the rest is marked unreadable', () => {
  const usdc = NETWORKS.arb.tokens.find((x) => x.symbol === 'USDC');
  assert.ok(usdc);
  const approve = `0x095ea7b3${word(OTHER)}${word((5_000_000n).toString(16))}`;
  const r = reviewCall(usdc.asset, approve, NETWORKS.arb.tokens);
  assert.equal(r.kind, 'erc20');
  if (r.kind === 'erc20') {
    assert.equal(r.fn, 'approve');
    assert.equal(r.token?.symbol, 'USDC');
    assert.equal(r.counterparty, OTHER);
    assert.equal(r.amount, 5_000_000n);
    assert.equal(r.unlimited, false);
    assert.equal(`${formatUnits(r.amount, r.token?.decimals ?? 0)}`, '5');
  }
  const unlimited = reviewCall(usdc.asset, `0x095ea7b3${word(OTHER)}${'f'.repeat(64)}`, NETWORKS.arb.tokens);
  assert.ok(unlimited.kind === 'erc20' && unlimited.unlimited);
  // A transfer of the max is not an allowance.
  const transferMax = reviewCall(usdc.asset, `0xa9059cbb${word(OTHER)}${'f'.repeat(64)}`, []);
  assert.ok(transferMax.kind === 'erc20' && !transferMax.unlimited && transferMax.token === null);
  const from = reviewCall(OTHER, `0x23b872dd${word(ME)}${word(OTHER)}${word('01')}`, []);
  assert.ok(from.kind === 'erc20' && from.fn === 'transferFrom' && from.owner === ME && from.counterparty === OTHER);
  // A dirty address word, a short body and an unknown selector are not ERC-20 calls.
  assert.equal(reviewCall(OTHER, `0x095ea7b3${'1'.repeat(64)}${word('01')}`, []).kind, 'contract');
  assert.equal(reviewCall(OTHER, `0x095ea7b3${word(OTHER)}`, []).kind, 'contract');
  assert.deepEqual(reviewCall(OTHER, '0xdeadbeef00', []), { kind: 'contract', selector: '0xdeadbeef', bytes: 5 });
  assert.deepEqual(reviewCall(OTHER, '0x', []), { kind: 'coin' });
});

/* ---------------------------------------------------------------- digests */

const COW = keccak_256(utf8ToBytes('cow'));

test('personal_sign is EIP-191 and recovers to the signer', () => {
  assert.equal(bytesToHex(personalSignDigest(utf8ToBytes('hello world'))), '0xd9eba16ed0ecae432b71fe008c98cc872bb4cc214d3220a36f365326cf807d68');
  const digest = personalSignDigest(utf8ToBytes('hello'));
  const sig = signEvmDigest(digest, COW);
  assert.match(sig, /^0x[0-9a-f]{130}$/);
  const bytes = Uint8Array.from(Buffer.from(sig.slice(2), 'hex'));
  const v = bytes[64];
  assert.ok(v === 27 || v === 28);
  const recovered = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), 'compact').addRecoveryBit(v - 27).recoverPublicKey(digest);
  const address = bytesToHex(keccak_256(recovered.toBytes(false).subarray(1)).subarray(12));
  assert.equal(address.toLowerCase(), evmAddressOf(COW).toLowerCase());
});

/** The example of EIP-712 itself (assets/eip-712/Example.js), in the v4 JSON a site sends. */
const MAIL = {
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
  domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
};

test('EIP-712 v4 matches the specification’s example', () => {
  const td = parseTypedData(JSON.stringify(MAIL));
  assert.equal(encodeType('Mail', td.types), 'Mail(Person from,Person to,string contents)Person(string name,address wallet)');
  assert.equal(bytesToHex(hashStruct('EIP712Domain', td.domain, td.types)), '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f');
  assert.equal(bytesToHex(hashStruct('Mail', td.message, td.types)), '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e');
  const digest = typedDataDigest(td);
  assert.equal(bytesToHex(digest), '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  // The example signs with keccak256("cow"), whose address is the `from` wallet.
  assert.equal(evmAddressOf(COW), MAIL.message.from.wallet);
  assert.equal(
    signEvmDigest(digest, COW),
    '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c',
  );
});

test('typed data is bound to the selected chain, and a permit is flagged', () => {
  assert.equal(parseEvmDappRequest('eth_signTypedData_v4', [ME, JSON.stringify(MAIL)], 1).kind, 'signTypedData');
  assert.equal(refusalKey(() => parseEvmDappRequest('eth_signTypedData_v4', [ME, JSON.stringify(MAIL)], 42161)), 'approve.evm.err.typedChain');
  // EIP712Domain left out: derived from the domain's fields, in their canonical order.
  const { EIP712Domain: _d, ...rest } = MAIL.types;
  assert.equal(bytesToHex(typedDataDigest(parseTypedData({ ...MAIL, types: rest }))), '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
  assert.equal(isPermitLike(parseTypedData(MAIL)), false);
  const permit = {
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    domain: { name: 'USD Coin', version: '2', chainId: '0xa4b1', verifyingContract: OTHER },
    message: { owner: ME, spender: OTHER, value: '1000000', nonce: 0, deadline: '1893456000' },
  };
  const parsed = parseEvmDappRequest('eth_signTypedData_v4', [ME, permit], 42161);
  assert.ok(parsed.kind === 'signTypedData' && isPermitLike(parsed.typed));
  // Values that do not fit their type are refusals, not truncations.
  assert.equal(refusalKey(() => typedDataDigest(parseTypedData({ ...permit, message: { ...permit.message, value: '-1' } }))), 'approve.evm.err.params');
  assert.equal(refusalKey(() => typedDataDigest(parseTypedData({ ...permit, message: { ...permit.message, spender: 'bob' } }))), 'approve.evm.err.params');
  assert.equal(refusalKey(() => parseTypedData('{')), 'approve.evm.err.params');
});

/* ------------------------------------------------------------------- fees */

test('the fee cap is a total, and a network without one gets nothing', () => {
  assert.equal(feeWithinCap(10n, 100n, 1000n), true);
  assert.equal(feeWithinCap(10n, 101n, 1000n), false);
  assert.equal(feeWithinCap(0n, 21000n, 1000n), true);
  assert.equal(feeWithinCap(1n, 1n, 0n), false);
  assert.equal(feeWithinCap(1n, 0n, 1000n), false);
});

/* ------------------------------------------------------------------- copy */

test('every key the EVM window can show exists', () => {
  const sources = ['src/lib/evmDapp.ts', 'src/lib/evmDappSend.ts', 'src/app/ApprovePopup.tsx'].map((p) => readFileSync(join(ROOT, p), 'utf8'));
  const keys = new Set(sources.flatMap((s) => s.match(/approve\.evm\.[A-Za-z]+(?:\.[A-Za-z]+)?/g) ?? []));
  for (const k of [...Object.values(EVM_APPROVE_TITLE_KEYS), ...Object.values(ERC20_FN_KEYS)]) keys.add(k);
  assert.ok(keys.size > 30);
  for (const k of keys) assert.ok(Object.hasOwn(T, k), `missing i18n key ${k}`);
});
