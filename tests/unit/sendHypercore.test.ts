/**
 * Sending on Hyperliquid's HyperCore (src/lib/send/hypercore.ts).
 *
 * The EIP-712 encoder and signer are pinned against Hyperliquid's official SDK vectors:
 *  - hyperliquid-python-sdk tests/signing_test.py `test_sign_usd_transfer_action` (commit 2fdb18f);
 *  - hyperliquid-rust-sdk's create_signature module, `test_sign_usd_transfer_action` (commit fa57729).
 * Neither SDK publishes a `spotSend` vector, so those below were produced by the Python SDK's own
 * payload code (`user_signed_payload` / `sign_user_signed_action`, `SPOT_TRANSFER_SIGN_TYPES`) run
 * with eth_account 0.13.7 — the same harness reproduces the `usdSend` vector above exactly.
 *
 * Then every refusal against a stubbed API, and that nothing reaches `/exchange` in any of them.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { NETWORKS, type NetworkDef } from '@/constants/networks';
import { HYPERCORE_API, HYPERCORE_SPOT_TOKENS } from '@/constants/hypercoreSend';
import { evmAddressOf } from '@/lib/evmTx';
import {
  SPOT_SEND,
  USD_SEND,
  hypercoreTypedDigest,
  isHypercoreAddress,
  minorToDecimal,
  sendHypercore,
  signHypercoreDigest,
} from '@/lib/send/hypercore';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const hx = (h: string) => hexToBytes(h.replace(/^0x/, ''));
const pad = (h: string) => `0x${h.replace(/^0x/, '').padStart(64, '0')}`;

/* ---------------------------------- vectors ---------------------------------- */

const PY_KEY = hx('0x0123456789012345678901234567890123456789012345678901234567890123');

test('usdSend signs as the Python SDK test pins it', () => {
  const digest = hypercoreTypedDigest(
    USD_SEND,
    { hyperliquidChain: 'Testnet', destination: '0x5e9ee1089755c3435139848e47e6635505d5a13a', amount: '1', time: 1687816341423n },
    '0x66eee',
  );
  assert.deepEqual(signHypercoreDigest(digest, PY_KEY), {
    r: '0x637b37dd731507cdd24f46532ca8ba6eec616952c56218baeff04144e4a77073',
    s: '0x11a6a24900e6e314136d2592e2f8d502cd89b7c15b198e1bee043c9589f9fad7',
    v: 27,
  });
});

test('usdSend signs as the Rust SDK test pins it (a checksummed destination string, signed as written)', () => {
  const key = hx('e908f86dbb4d55ac876378565aafeabc187f6690f046459397b17d9b9a19688e');
  const digest = hypercoreTypedDigest(
    USD_SEND,
    { hyperliquidChain: 'Testnet', destination: '0x0D1d9635D0640821d15e323ac8AdADfA9c111414', amount: '1', time: 1690393044548n },
    `0x${(421614).toString(16)}`,
  );
  const sig = signHypercoreDigest(digest, key);
  assert.equal(
    `${sig.r}${sig.s.slice(2)}${sig.v.toString(16)}`,
    '0x214d507bbdaebba52fa60928f904a8b2df73673e3baba6133d66fe846c7ef70451e82453a6d8db124e7ed6e60fa00d4b7c46e4d96cb2bd61fd81b6e8953cc9d21b',
  );
});

test("the action types are the SDKs' own type strings", () => {
  const typeString = (t: typeof SPOT_SEND) => `${t.primaryType}(${t.fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
  // hyperliquid-rust-sdk's exchange actions module, the literals hashed by `SpotSend` / `UsdSend`
  assert.equal(typeString(SPOT_SEND), 'HyperliquidTransaction:SpotSend(string hyperliquidChain,string destination,string token,string amount,uint64 time)');
  assert.equal(typeString(USD_SEND), 'HyperliquidTransaction:UsdSend(string hyperliquidChain,string destination,string amount,uint64 time)');
});

const SPOT_VECTORS = [
  {
    message: { hyperliquidChain: 'Mainnet', destination: '0x5e9ee1089755c3435139848e47e6635505d5a13a', token: 'HYPE:0x0d01dc56dcaaca66ad901c959b4011ec', amount: '0.1', time: 1716531066415n },
    sig: { r: '0x919704d01b1df6cb13d1c9156fac9bf687bff79b3f4d8df36e236cce2d4e7e2d', s: '0x446d603f7d3ddb721a1508c21c26020e3c91823e9478b23d7df27802ce7123df', v: 27 },
  },
  {
    message: { hyperliquidChain: 'Testnet', destination: '0x5e9ee1089755c3435139848e47e6635505d5a13a', token: 'HYPE:0x7317beb7cceed72ef0b346074cc8e7ab', amount: '12.5', time: 1716531066415n },
    sig: { r: '0xc4f2514c4e29c5e9562148dfcb1c99a217ecf19d746a44f9034620af02f0d5df', s: pad('0x5a29f56cdfbe4e702a3a2e9a2f6300d46c2d811cce867b59a1ccc3c5d1d18dd'), v: 28 },
  },
  {
    message: { hyperliquidChain: 'Mainnet', destination: '0x5e9ee1089755c3435139848e47e6635505d5a13a', token: 'USDC:0x6d1e7cde53ba9467b783cb7c530ce054', amount: '1.00000001', time: 1793295234394n },
    sig: { r: '0xd7d7e2cdb6e71ab0f3ea18755cfde9081dfb9d7498822fc8f84582ae459beee4', s: '0x4b24f40419b772193f3d59ee7214a45d2c91191ac79fdfb6e42347e07927b1ef', v: 28 },
  },
];

test('spotSend signs as the Python SDK signing code does', () => {
  for (const v of SPOT_VECTORS) {
    assert.deepEqual(signHypercoreDigest(hypercoreTypedDigest(SPOT_SEND, v.message, '0x66eee'), PY_KEY), v.sig);
  }
});

test('hyperliquidChain binds the signature to its network', () => {
  const m = SPOT_VECTORS[0].message;
  const main = hypercoreTypedDigest(SPOT_SEND, m, '0x66eee');
  const test = hypercoreTypedDigest(SPOT_SEND, { ...m, hyperliquidChain: 'Testnet' }, '0x66eee');
  assert.notEqual(bytesToHex(main), bytesToHex(test));
});

test('amounts are written exactly, without trailing zeros', () => {
  assert.equal(minorToDecimal(100_000_000n, 8), '1');
  assert.equal(minorToDecimal(150_000_000n, 8), '1.5');
  assert.equal(minorToDecimal(1n, 8), '0.00000001');
  assert.equal(minorToDecimal(123_456_789_012n, 8), '1234.56789012');
  assert.equal(minorToDecimal(9_007_199_254_740_993_000n, 8), '90071992547.40993');
});

test('a recipient is a 0x address whose mixed case is its EIP-55 checksum', () => {
  assert.ok(isHypercoreAddress('hypercore', '0x0D1d9635D0640821d15e323ac8AdADfA9c111414', 'mainnet'));
  assert.ok(isHypercoreAddress('hypercore', '0x0d1d9635d0640821d15e323ac8adadfa9c111414', 'testnet'));
  assert.ok(isHypercoreAddress('hypercore', '0x0D1D9635D0640821D15E323AC8ADADFA9C111414', 'mainnet'));
  assert.ok(!isHypercoreAddress('hypercore', '0x0D1d9635D0640821d15e323ac8AdADfA9c111415', 'mainnet'));
  assert.ok(!isHypercoreAddress('hypercore', '0x0d1D9635D0640821d15e323ac8AdADfA9c111414', 'mainnet'));
  assert.ok(!isHypercoreAddress('hypercore', '0d1d9635d0640821d15e323ac8adadfa9c111414', 'mainnet'));
  assert.ok(!isHypercoreAddress('eth', '0x0d1d9635d0640821d15e323ac8adadfa9c111414', 'mainnet'));
});

/* ---------------------------------- stubbed API ---------------------------------- */

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OWNER = evmAddressOf(SECRET);
const EXISTING = '0x5E9ee1089755c3435139848E47e6635505D5A13a'.toLowerCase();
const NEW_ADDRESS = `0x${'ab'.repeat(20)}`;

interface ApiState {
  role?: string;
  balances?: { coin: string; total: string; hold?: string }[];
  /** preTransferCheck: the fee for a destination, by address. */
  fees?: Record<string, string>;
  sanctioned?: boolean;
  mid?: string;
  exchange?: unknown;
  /** The ledger's entries once the transfer landed; `nonce` is filled in from the posted action. */
  ledgerHash?: string;
}

interface Seen {
  hosts: string[];
  infos: string[];
  exchange: { action: Record<string, unknown>; nonce: number; signature: { r: string; s: string; v: number } }[];
}

function api(s: ApiState): Seen {
  const seen: Seen = { hosts: [], infos: [], exchange: [] };
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    seen.hosts.push(new URL(url).origin);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const reply = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.endsWith('/exchange')) {
      seen.exchange.push(body as unknown as Seen['exchange'][number]);
      return reply(s.exchange ?? { status: 'ok', response: { type: 'default' } });
    }
    if (!url.endsWith('/info')) throw new Error(`unexpected ${url}`);
    seen.infos.push(String(body.type));
    switch (body.type) {
      case 'userRole':
        return reply({ role: s.role ?? 'user' });
      case 'spotClearinghouseState':
        return reply({
          balances: (s.balances ?? [{ coin: 'USDC', total: '10.0' }, { coin: 'HYPE', total: '2.0' }]).map((b, i) => ({ token: i, hold: '0.0', entryNtl: '0.0', ...b })),
        });
      case 'preTransferCheck':
        return reply({ isSanctioned: s.sanctioned ?? false, userExists: true, fee: s.fees?.[String(body.user)] ?? '0.0', userHasSentTx: false });
      case 'allMids':
        return reply({ '@107': s.mid ?? '95.0125', '@1035': s.mid ?? '89.9185', BTC: '100000.0' });
      case 'userNonFundingLedgerUpdates': {
        const sent = seen.exchange[0];
        return reply(
          sent && s.ledgerHash
            ? [{ time: sent.nonce + 500, hash: s.ledgerHash, delta: { type: 'spotTransfer', token: 'HYPE', amount: '1.0', user: OWNER.toLowerCase(), destination: sent.action.destination, fee: '0.0', nonce: sent.nonce } }]
            : [],
        );
      }
      default:
        throw new Error(`unexpected info ${String(body.type)}`);
    }
  }) as typeof fetch;
  return seen;
}

const mainDef = (send = true): NetworkDef => ({ ...NETWORKS.hypercore, send });
const testDef = (): NetworkDef => ({
  ...NETWORKS.hypercore,
  balance: { kind: 'hypercore', api: `${HYPERCORE_API.testnet}/info` },
  tokens: [],
  send: true,
});

const transfer = (over: Partial<Parameters<typeof sendHypercore>[0]> = {}) => ({
  network: 'hypercore' as const,
  env: 'mainnet' as const,
  def: mainDef(),
  secret: SECRET,
  owner: OWNER,
  asset: 'native',
  to: EXISTING,
  amount: 100_000_000n,
  maxFee: 5_000_000n,
  ...over,
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

/** The digest of what was posted, rebuilt from the action as the exchange reads it. */
const digestOfPosted = (action: object, nonce: number) => {
  const a = action as Record<string, unknown>;
  const message = { hyperliquidChain: String(a.hyperliquidChain), destination: String(a.destination), token: String(a.token), amount: String(a.amount), time: BigInt(nonce) };
  assert.equal(a.time, nonce);
  return hypercoreTypedDigest(SPOT_SEND, message, String(a.signatureChainId));
};

test('a HYPE send is a spotSend signed for Mainnet, posted to the constant host, answered by the ledger hash', async () => {
  const hash = `0x${'cd'.repeat(32)}`;
  const seen = api({ ledgerHash: hash });
  const to = '0x0D1d9635D0640821d15e323ac8AdADfA9c111414';
  assert.equal(await sendHypercore(transfer({ to, amount: 150_000_000n }), 0), hash);
  assert.equal(seen.exchange.length, 1);
  const { action, nonce, signature } = seen.exchange[0];
  assert.deepEqual(action, {
    type: 'spotSend',
    signatureChainId: '0x66eee',
    hyperliquidChain: 'Mainnet',
    destination: to.toLowerCase(),
    token: `HYPE:${HYPERCORE_SPOT_TOKENS.mainnet.native.tokenId}`,
    amount: '1.5',
    time: nonce,
  });
  const digest = digestOfPosted(action, nonce);
  assert.deepEqual(signature, signHypercoreDigest(digest, SECRET));
  assert.deepEqual([...new Set(seen.hosts)], [HYPERCORE_API.mainnet]);
});

test('USDC goes as its own spot token; the test network signs Testnet with its own HYPE id', async () => {
  let seen = api({});
  await sendHypercore(transfer({ asset: 'USDC', amount: 250_000_000n }), 0);
  assert.equal(seen.exchange[0].action.token, `USDC:${HYPERCORE_SPOT_TOKENS.mainnet.USDC.tokenId}`);
  assert.equal(seen.exchange[0].action.amount, '2.5');
  seen = api({});
  await sendHypercore(transfer({ env: 'testnet', def: testDef() }), 0);
  assert.equal(seen.exchange[0].action.hyperliquidChain, 'Testnet');
  assert.equal(seen.exchange[0].action.token, `HYPE:${HYPERCORE_SPOT_TOKENS.testnet.native.tokenId}`);
  assert.deepEqual([...new Set(seen.hosts)], [HYPERCORE_API.testnet]);
});

test('without a ledger entry, the answer is the signed action digest', async () => {
  const seen = api({});
  const id = await sendHypercore(transfer(), 0);
  const { action, nonce } = seen.exchange[0];
  const digest = digestOfPosted(action, nonce);
  assert.equal(id, `0x${bytesToHex(digest)}`);
});

test('an activation fee within maxFee is paid from USDC on top of the amount', async () => {
  // 1 USDC at 95.0125 USDC/HYPE is 0.01052494 HYPE (rounded up)
  const seen = api({ fees: { [NEW_ADDRESS]: '1.0' } });
  await sendHypercore(transfer({ to: NEW_ADDRESS, maxFee: 1_052_494n }), 0);
  assert.equal(seen.exchange.length, 1);
  assert.ok(seen.infos.includes('allMids'));
});

test('a host other than the constant one, or a definition that does not send, is refused without a request', async () => {
  const seen = api({});
  const elsewhere: NetworkDef = { ...NETWORKS.hypercore, send: true, balance: { kind: 'hypercore', api: 'https://api.hyperliquid.example/info' } };
  assert.equal(await refusal(sendHypercore(transfer({ def: elsewhere }), 0)), 'chain');
  // the main network's host in test mode, and the test network's in main mode
  assert.equal(await refusal(sendHypercore(transfer({ env: 'testnet', def: mainDef() }), 0)), 'chain');
  assert.equal(await refusal(sendHypercore(transfer({ def: testDef() }), 0)), 'chain');
  assert.equal(await refusal(sendHypercore(transfer({ def: mainDef(false) }), 0)), 'chain');
  assert.equal(await refusal(sendHypercore(transfer({ network: 'eth', def: { ...NETWORKS.eth } }), 0)), 'chain');
  assert.deepEqual(seen.hosts, []);
});

test('only HYPE or a registry token, to a valid address, of a positive amount', async () => {
  const seen = api({});
  assert.equal(await refusal(sendHypercore(transfer({ asset: 'PURR' }), 0)), 'address');
  // the test network lists no token
  assert.equal(await refusal(sendHypercore(transfer({ env: 'testnet', def: testDef(), asset: 'USDC' }), 0)), 'address');
  assert.equal(await refusal(sendHypercore(transfer({ to: '0x0d1D9635D0640821d15e323ac8AdADfA9c111414' }), 0)), 'address');
  assert.equal(await refusal(sendHypercore(transfer({ to: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' }), 0)), 'address');
  assert.equal(await refusal(sendHypercore(transfer({ amount: 0n }), 0)), 'minimum');
  assert.deepEqual(seen.hosts, []);
});

test('an account that never received anything is unfunded', async () => {
  const seen = api({ role: 'missing', balances: [] });
  assert.equal(await refusal(sendHypercore(transfer(), 0)), 'unfunded');
  assert.deepEqual(seen.exchange, []);
});

test('a sanctioned destination is refused', async () => {
  const seen = api({ sanctioned: true });
  assert.equal(await refusal(sendHypercore(transfer(), 0)), 'address');
  assert.deepEqual(seen.exchange, []);
});

test('the amount must be free in the spot balance, and the activation fee in USDC on top', async () => {
  // HYPE: 2.0 held, 0.75 of it on hold in orders
  let seen = api({ balances: [{ coin: 'USDC', total: '10.0' }, { coin: 'HYPE', total: '2.0', hold: '0.75' }] });
  assert.equal(await refusal(sendHypercore(transfer({ amount: 125_000_001n }), 0)), 'funds');
  assert.deepEqual(seen.exchange, []);
  // a coin missing from the list is a known zero
  seen = api({ balances: [{ coin: 'USDC', total: '10.0' }] });
  assert.equal(await refusal(sendHypercore(transfer(), 0)), 'funds');
  // USDC to a new address: 9.5 + 1 fee > 10
  seen = api({ fees: { [NEW_ADDRESS]: '1.0' } });
  assert.equal(await refusal(sendHypercore(transfer({ asset: 'USDC', to: NEW_ADDRESS, amount: 950_000_000n }), 0)), 'funds');
  // HYPE to a new address with no USDC for the fee
  seen = api({ fees: { [NEW_ADDRESS]: '1.0' }, balances: [{ coin: 'USDC', total: '0.5' }, { coin: 'HYPE', total: '2.0' }] });
  assert.equal(await refusal(sendHypercore(transfer({ to: NEW_ADDRESS }), 0)), 'funds');
  assert.deepEqual(seen.exchange, []);
  // the exchange's own verdict
  api({ exchange: { status: 'err', response: 'Insufficient balance for token transfer' } });
  assert.equal(await refusal(sendHypercore(transfer(), 0)), 'funds');
});

test('an activation fee beyond maxFee, or beyond the documented 1 USDC, is refused', async () => {
  let seen = api({ fees: { [NEW_ADDRESS]: '1.0' } });
  assert.equal(await refusal(sendHypercore(transfer({ to: NEW_ADDRESS, maxFee: 1_052_493n }), 0)), 'fee');
  assert.equal(await refusal(sendHypercore(transfer({ to: NEW_ADDRESS, maxFee: 0n }), 0)), 'fee');
  assert.deepEqual(seen.exchange, []);
  seen = api({ fees: { [EXISTING]: '1.5' } });
  assert.equal(await refusal(sendHypercore(transfer({ maxFee: 10n ** 18n }), 0)), 'fee');
  assert.deepEqual(seen.exchange, []);
});

test('a key that is not the owner account signs nothing', async () => {
  const seen = api({});
  assert.match(String(await refusal(sendHypercore(transfer({ owner: EXISTING }), 0))), /does not control/);
  assert.deepEqual(seen.hosts, []);
});

test('an exchange refusal is an error that does not repeat addresses', async () => {
  api({ exchange: { status: 'err', response: `User or API Wallet ${OWNER.toLowerCase()} does not exist.` } });
  const why = String(await refusal(sendHypercore(transfer(), 0)));
  assert.match(why, /refused/);
  assert.ok(!why.toLowerCase().includes(OWNER.toLowerCase().slice(2)));
});

test('the domain type hash is the one EIP-712 defines', () => {
  // keccak of the domain type string, as every EIP-712 implementation spells it
  assert.equal(
    bytesToHex(keccak_256(utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'))),
    '8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f',
  );
});
