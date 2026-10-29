/**
 * Paying on Bitcoin, Litecoin, Dogecoin, Dash and Bitcoin Cash (src/lib/send/utxo.ts and its
 * serializer src/lib/send/utxoTx.ts), against stubbed APIs — no network access.
 *
 * Pinned: the wire format and both signature digests against published vectors (BIP143's own
 * example, Bitcoin Core's and Bitcoin Cash Node's sighash.json) and against transactions the
 * networks accepted; the recipients each network takes (BIP350's and the cashaddr spec's
 * vectors); and every refusal — an API serving another chain, a fee past `maxFee`, a token, a
 * recipient the network does not take, dust, too little confirmed money — none of which
 * broadcasts anything.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createBase58check } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from 'bip39';
import type { ChainNet } from '@/constants/chains';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { DERIVATION_PATHS, NETWORKS, type NetworkId } from '@/constants/networks';
import { BCH_BITCORE_API, BCH_CHECKPOINT, ESPLORA_GENESIS_HASH } from '@/constants/utxoSend';
import { hash160 } from '@/lib/addresses/utxo';
import { networkAddressesFromMnemonic } from '@/lib/chainAddresses';
import { isUtxoAddress, sendUtxo, utxoDustOf, utxoRecipientScript } from '@/lib/send/utxo';
import { bip143Sighash, legacySighash, p2pkhScript, serializeTx, signDigest, txidOf, type Tx } from '@/lib/send/utxoTx';
import { networkDefOn, testnetAddress } from '@/lib/testnets';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/* --------------------------------- helpers -------------------------------- */

const rev = (hex: string) => bytesToHex(hexToBytes(hex).reverse());
/** base58check (double SHA-256 checksum) for building fixtures, from the library the wallet uses. */
const base58check = (payload: Uint8Array) => createBase58check(sha256).encode(payload);

/** A transaction off the wire, witnesses included (the test's own reader, independent of the writer). */
function parseTx(hex: string): { tx: Tx; scriptSigs: Uint8Array[]; witnesses: Uint8Array[][] } {
  const b = hexToBytes(hex);
  let o = 0;
  const take = (n: number) => {
    const s = b.slice(o, o + n);
    o += n;
    return s;
  };
  const u32 = () => {
    const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    o += 4;
    return v;
  };
  const vi = () => {
    const f = b[o++];
    if (f < 0xfd) return f;
    if (f === 0xfd) {
      const v = b[o] | (b[o + 1] << 8);
      o += 2;
      return v;
    }
    return u32();
  };
  const u64 = () => {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
    o += 8;
    return v;
  };
  const version = u32() | 0;
  const segwit = b[o] === 0 && b[o + 1] === 1;
  if (segwit) o += 2;
  const inputs: Tx['inputs'] = [];
  const scriptSigs: Uint8Array[] = [];
  for (let i = vi(); i > 0; i--) {
    const txid = bytesToHex(take(32).reverse());
    const vout = u32();
    scriptSigs.push(take(vi()));
    inputs.push({ txid, vout, sequence: u32() });
  }
  const outputs: Tx['outputs'] = [];
  for (let i = vi(); i > 0; i--) {
    const value = u64();
    outputs.push({ value, script: take(vi()) });
  }
  const witnesses: Uint8Array[][] = [];
  if (segwit) for (let i = 0; i < inputs.length; i++) witnesses.push(Array.from({ length: vi() }, () => take(vi())));
  const locktime = u32();
  assert.equal(o, b.length, 'no trailing bytes');
  return { tx: { version, inputs, outputs, locktime }, scriptSigs, witnesses };
}

/** The two pushes of a P2PKH scriptSig. */
function splitScriptSig(script: Uint8Array): { sig: Uint8Array; pub: Uint8Array } {
  const sigLen = script[0];
  const sig = script.slice(1, 1 + sigLen);
  const pubLen = script[1 + sigLen];
  const pub = script.slice(2 + sigLen, 2 + sigLen + pubLen);
  assert.equal(2 + sigLen + pubLen, script.length);
  return { sig, pub };
}

const verifies = (sigWithType: Uint8Array, digest: Uint8Array, pub: Uint8Array) =>
  secp256k1.verify(sigWithType.slice(0, -1), digest, pub, { prehash: false, lowS: true, format: 'der' });

const seed = mnemonicToSeedSync(DEBUG_WALLET_PHRASE);
const ADDRESSES = await networkAddressesFromMnemonic(DEBUG_WALLET_PHRASE);
type Utxo = 'btc' | 'ltc' | 'doge' | 'dash' | 'bch';
/** The test phrase's key at the network's path (SEP-5's public phrase: no one's funds). */
function secretOf(network: Utxo): Uint8Array {
  const key = HDKey.fromMasterSeed(seed).derive(DERIVATION_PATHS[network]).privateKey;
  assert.ok(key);
  return Uint8Array.from(key);
}
function ownerOf(network: Utxo, env: ChainNet = 'mainnet'): string {
  const main = ADDRESSES[network];
  assert.ok(main);
  return env === 'mainnet' ? main : (testnetAddress(network, main) ?? '');
}

interface Call {
  method: string;
  url: string;
  body?: string;
  type?: string;
}
type Reply = { status?: number; body: string };

/** Answer each request by `METHOD url` pattern; record every request made. */
function stub(routes: [RegExp, (call: Call) => Reply][]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init.method ?? 'GET', url: String(input), body: init.body as string | undefined, type: headers['content-type'] };
    calls.push(call);
    const route = routes.find(([re]) => re.test(`${call.method} ${call.url}`));
    if (!route) throw new Error(`unexpected ${call.method} ${call.url}`);
    const reply = route[1](call);
    return new Response(reply.body, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return calls;
}
const json = (v: unknown): Reply => ({ body: JSON.stringify(v) });
const posted = (calls: Call[]) => calls.filter((c) => c.method === 'POST');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function refusal(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
}

const transfer = (network: Utxo, to: string, amount: bigint, extra: { env?: ChainNet; maxFee?: bigint; asset?: string; memo?: string; owner?: string } = {}) => {
  const env = extra.env ?? 'mainnet';
  const def = networkDefOn(network, env) ?? NETWORKS[network];
  return {
    network: network as NetworkId,
    env,
    def,
    secret: secretOf(network),
    owner: extra.owner ?? ownerOf(network, env),
    asset: extra.asset ?? 'native',
    to,
    amount,
    memo: extra.memo,
    maxFee: extra.maxFee ?? 10n ** 9n,
  };
};

const H = (byte: string) => byte.repeat(32);

/* ------------------------- published vectors (BIP143) ---------------------- */

// BIP143, "Native P2WPKH" (github.com/bitcoin/bips/blob/master/bip-0143.mediawiki): input 0 is
// a legacy P2PK spend (legacy digest), input 1 a native P2WPKH one (BIP143 digest). Both keys,
// the digest and the whole signed transaction are given there.
const BIP143_UNSIGNED =
  '0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000';
const BIP143_SIGNED =
  '01000000000102fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f00000000494830450221008b9d1dc26ba6a9cb62127b02742fa9d754cd3bebf337f7a55d114c8e5cdd30be022040529b194ba3f9281a99f2b1c0a19c0489bc22ede944ccf4ecbab4cc618ef3ed01eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac000247304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee0121025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee635711000000';

test('BIP143 native P2WPKH: the digest, both signatures and the signed transaction, byte for byte', () => {
  const { tx, scriptSigs } = parseTx(BIP143_UNSIGNED);
  assert.equal(bytesToHex(serializeTx(tx, scriptSigs)), BIP143_UNSIGNED);

  const k1 = hexToBytes('619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9');
  const pub1 = secp256k1.getPublicKey(k1, true);
  assert.equal(bytesToHex(pub1), '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357');
  const digest1 = bip143Sighash(tx, 1, p2pkhScript(hash160(pub1)), 600_000_000n, 1);
  assert.equal(bytesToHex(digest1), 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670');
  const sig1 = signDigest(digest1, k1, 1);
  assert.equal(bytesToHex(sig1), '304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee01');

  const k0 = hexToBytes('bbc27228ddcb9209d7fd6f36b02f7dfa6252af40bb2f1cbc7a557da8027ff866');
  const p2pk = hexToBytes('2103c9f4836b9a4f77fc0d81f7bcb01b7f1b35916864b9476c241ce9fc198bd25432ac');
  const sig0 = signDigest(legacySighash(tx, 0, p2pk, 1), k0, 1);
  const scriptSig0 = Uint8Array.from([sig0.length, ...sig0]);

  const signed = serializeTx(tx, [scriptSig0, new Uint8Array(0)], [[], [sig1, pub1]]);
  assert.equal(bytesToHex(signed), BIP143_SIGNED);
  // The txid hashes the witness-free form.
  assert.equal(txidOf(tx, [scriptSig0, new Uint8Array(0)]), txidOf(parseTx(BIP143_SIGNED).tx, parseTx(BIP143_SIGNED).scriptSigs));
});

// Bitcoin Core's test data sighash.json (github.com/bitcoin/bitcoin): [raw tx, script, input,
// hash type, digest as uint256 hex]. These four have SIGHASH_ALL semantics (the low five bits
// neither NONE nor SINGLE, no ANYONECANPAY) and no OP_CODESEPARATOR; all 139 such vectors of the
// file matched when this was written.
const CORE_LEGACY: [string, string, number, number, string][] = [
  [
    '907c2bc503ade11cc3b04eb2918b6f547b0630ab569273824748c87ea14b0696526c66ba740200000004ab65ababfd1f9bdd4ef073c7afc4ae00da8a66f429c917a0081ad1e1dabce28d373eab81d8628de802000000096aab5253ab52000052ad042b5f25efb33beec9f3364e8a9139e8439d9d7e26529c3c30b6c3fd89f8684cfd68ea0200000009ab53526500636a52ab599ac2fe02a526ed040000000008535300516352515164370e010000000003006300ab2ec229',
    '',
    2,
    1864164639,
    '31af167a6cf3f9d5f6875caa4d31704ceb0eba078d132b78dab52c3b8997317e',
  ],
  [
    'a0aa3126041621a6dea5b800141aa696daf28408959dfb2df96095db9fa425ad3f427f2f6103000000015360290e9c6063fa26912c2e7fb6a0ad80f1c5fea1771d42f12976092e7a85a4229fdb6e890000000001abc109f6e47688ac0e4682988785744602b8c87228fcef0695085edf19088af1a9db126e93000000000665516aac536affffffff8fe53e0806e12dfd05d67ac68f4768fdbe23fc48ace22a5aa8ba04c96d58e2750300000009ac51abac63ab5153650524aa680455ce7b000000000000499e50030000000008636a00ac526563ac5051ee030000000003abacabd2b6fe000000000003516563910fb6b5',
    '65',
    0,
    -1391424484,
    '48d6a1bd2cd9eec54eb866fc71209418a950402b5d7e52363bfb75c98e141175',
  ],
  [
    '50818f4c01b464538b1e7e7f5ae4ed96ad23c68c830e78da9a845bc19b5c3b0b20bb82e5e9030000000763526a63655352ffffffff023b3f9c040000000008630051516a6a5163a83caf01000000000553ab65510000000000',
    '6aac',
    0,
    946795545,
    '746306f322de2b4b58ffe7faae83f6a72433c22f88062cdde881d4dd8a5a4e2d',
  ],
  [
    '04bac8c5033460235919a9c63c42b2db884c7c8f2ed8fcd69ff683a0a2cccd9796346a04050200000003655351fcad3a2c5a7cbadeb4ec7acc9836c3f5c3e776e5c566220f7f965cf194f8ef98efb5e3530200000007526a006552526526a2f55ba5f69699ece76692552b399ba908301907c5763d28a15b08581b23179cb01eac03000000075363ab6a516351073942c2025aa98a05000000000765006aabac65abd7ffa6030000000004516a655200000000',
    '53ac6365ac526a',
    1,
    764174870,
    'bf5fdc314ded2372a0ad078568d76c5064bf2affbde0764c335009e56634481b',
  ],
];

test("Bitcoin Core's legacy sighash vectors (SIGHASH_ALL semantics)", () => {
  for (const [raw, script, index, hashType, want] of CORE_LEGACY) {
    const { tx } = parseTx(raw);
    assert.equal(rev(bytesToHex(legacySighash(tx, index, hexToBytes(script), hashType))), want);
  }
});

// Bitcoin Cash Node's test data sighash.json (gitlab.com/bitcoin-cash-node/bitcoin-cash-node):
// [raw tx, script, input, hash type, digest with SCRIPT_ENABLE_SIGHASH_FORKID, digest without],
// the spent amount being zero in its harness (sighash_tests.cpp). These four carry the FORKID
// bit with ALL semantics; all 113 such vectors of the file matched when this was written.
const BCHN_FORKID: [string, string, number, number, string][] = [
  [
    '5d1142b103f09b97324a6ff96f4d41d889d16d2ac1f314edb38fb0f6c21f8a5fb59fda27b301000000050051ab53acffffffffd539f10298b5aacd1631287e37799fb8b22fcaace26a171ff0319bf5a2b567b701000000026365f37069897cd43ba3118d4d54dec113e119ff65d4bcfdba128fa223baadc1c628e641f82b00000000025352ffffffff04c0ee16000000000002006accc69d0500000000036a6351c39712030000000002ac5291b0ed000000000003abab0000000000',
    '52ab51',
    1,
    709074270,
    '862713ebacc4f366a2ae3df618be57e49985d1c0e109966e9e127bf952d8dc42',
  ],
  [
    '043157240271ec9ddb08e4ab57f238a703e936745f8f70ec8be5bb148eb458b59dfa3eb7d50200000007ac516a00526552595d4acde298de140682b176936432c29bb8580e60090f85bb0463b2b4e4507b27417f4203000000046552005148e37dd504b16cf203000000000852ac65536353acabb3c932020000000001ac899b390100000000036a5365a1109e01000000000800ac536a5363ac00ebeaf805',
    '006552ab6553ab',
    1,
    1559297614,
    'e80a85e86588f7c0799afb2e4424508df12ee21005eba1a6759820d899f8bf45',
  ],
  [
    '9f88beb00285746ab675afdc569ca0a0e9ad16d1c88411b7f34efa2462d77a1df985f044340100000003005365ffffffff0862484f103c77855322d0d55a30cfae0e11d06bd313438e3a10a1346dfb8a8d0200000005abac000000ffffffff033730c0020000000001524cc317000000000006abac51ac0053e98852010000000004acab656a5a2beb14',
    '535363ab63',
    1,
    -185369265,
    'd882da3bb11b01a352460e272e969b65756ead51026c371b43fdb885496031e0',
  ],
  [
    'd7b91326021d1a1f87cfb5dfafe4ff213b129bd9f7131fd9fbbc55982517d702e32abdabf90100000003ab51acffffffff7fe6e082d30551c6d712b9ad7f79e6b1a842fc0735b72e3c5e5a6d3277170a11010000000563ababab63ffffffff02bd8b71020000000002ac514ce61a050000000006acab0053655300000000',
    'ac006aab5351',
    0,
    1473208669,
    'ba182be4faf9935403fc5d7ba0e08c636e39a05a202e8b1b7982da7c2a7ba30e',
  ],
];

test("Bitcoin Cash Node's FORKID sighash vectors (BIP143-style digest, SIGHASH_ALL semantics)", () => {
  for (const [raw, script, index, hashType, want] of BCHN_FORKID) {
    assert.ok(hashType & 0x40, 'the vector carries the FORKID bit');
    const { tx } = parseTx(raw);
    assert.equal(rev(bytesToHex(bip143Sighash(tx, index, hexToBytes(script), 0n, hashType))), want);
  }
});

test('only SIGHASH_ALL semantics are built: NONE, SINGLE and ANYONECANPAY are refused', () => {
  const { tx } = parseTx(BIP143_UNSIGNED);
  for (const hashType of [0x02, 0x03, 0x81, 0x42]) {
    assert.throws(() => legacySighash(tx, 0, new Uint8Array(0), hashType));
    assert.throws(() => bip143Sighash(tx, 0, new Uint8Array(0), 0n, hashType));
  }
});

/* ------------------------ transactions the networks took ------------------------ */

test('a Bitcoin Cash mainnet transaction verifies under our FORKID digest and not under the legacy one', () => {
  // 47dd911cb857da6c3733fa57395f882bc53512c16849664be287893e7abb141a, mined in block 975 056;
  // the spent output (51a94816…79cc:1, 669 438 521 sat, P2PKH) as Bitcore lists it.
  const raw =
    '0100000001cc792a4e085ca1b37ebe3d3017642f74c979f26beb00b433378394161648a951010000006b48304502210087137a0a40899fd85d8e4416ea8dff309dd323bd30a3ea5ddc88fcb1937f9b06022005e9a22fa01a76651b53c4a4ee06389ea9b820c56a578c0aa8c8d91b13fac1ed4121021f6f8e1ed0630deee76a1a7b55fbfc5c4d8e53d44b6fe82b23e4e156393cd5bbffffffff022ee3df00000000001976a9146b5e3551e8a38344524450509041470068a536bd88ac29ee0627000000001976a914f73d956414457fe246c1d32c43b0a73199fcc43988ac00000000';
  const { tx, scriptSigs } = parseTx(raw);
  assert.equal(txidOf(tx, scriptSigs), '47dd911cb857da6c3733fa57395f882bc53512c16849664be287893e7abb141a');
  const { sig, pub } = splitScriptSig(scriptSigs[0]);
  assert.equal(sig[sig.length - 1], 0x41);
  const script = hexToBytes('76a914b5c85ea31f3e55c3f91d57fd2237ddfb238370d688ac');
  assert.deepEqual(p2pkhScript(hash160(pub)), script);
  assert.ok(verifies(sig, bip143Sighash(tx, 0, script, 669_438_521n, 0x41), pub));
  assert.ok(!verifies(sig, legacySighash(tx, 0, script, 0x41), pub));
  assert.ok(!verifies(sig, bip143Sighash(tx, 0, script, 669_438_522n, 0x41), pub), 'the digest commits to the input value');
});

test('a Dogecoin mainnet transaction verifies under our legacy digest', () => {
  // 1b51a116ba75cc0dd9e13b86bd570629427a5d7d009d80706f4ba16137f5eee8 (block 6 423 225), spending
  // be312305…5a61:114, a P2PKH output of DSP4tRb1gSftwfTXu9t2CKbeymGMnPVY3T (BlockCypher).
  const raw =
    '0100000001615a707f63c215b7bb474ba08df0fe8b828f1571a15bb9608c3531b3052331be720000006b483045022100c4f1ebf422193ede80c60bef1342f32862f2d7986151ef0f9a80d5e16fddaf3b022020d736c5d645420f77ee54123974bdabbb3b4fea0b0245be92039531cc07b2a80121027af95cdd6c4be5ba0db8d0618b73f5269ffc62b6c840163646ac0b08c05c9be8ffffffff025ae4ae05000000001976a914830a7420e63d76244ff7cbd1c248e94c1446325988ac4bece705000000001976a914e8ff15ed1b37d01e4fc6e4c768e7dafe0cd5bc8a88ac00000000';
  const { tx, scriptSigs } = parseTx(raw);
  assert.equal(txidOf(tx, scriptSigs), '1b51a116ba75cc0dd9e13b86bd570629427a5d7d009d80706f4ba16137f5eee8');
  const { sig, pub } = splitScriptSig(scriptSigs[0]);
  const script = utxoRecipientScript('doge', 'DSP4tRb1gSftwfTXu9t2CKbeymGMnPVY3T', 'mainnet');
  assert.ok(script);
  assert.deepEqual(p2pkhScript(hash160(pub)), script);
  assert.ok(verifies(sig, legacySighash(tx, 0, script, 1), pub));
});

/* --------------------------------- recipients -------------------------------- */

test("the wallet's own addresses decode to the key's own script on every network", () => {
  for (const network of ['btc', 'ltc', 'doge', 'dash', 'bch'] as const) {
    const keyHash = hash160(secp256k1.getPublicKey(secretOf(network), true));
    const expected = network === 'btc' || network === 'ltc' ? Uint8Array.from([0x00, 0x14, ...keyHash]) : p2pkhScript(keyHash);
    assert.deepEqual(utxoRecipientScript(network, ownerOf(network), 'mainnet'), expected, network);
    if (network === 'btc' || network === 'ltc') assert.deepEqual(utxoRecipientScript(network, ownerOf(network, 'testnet'), 'testnet'), expected);
  }
});

test('BIP350 segwit vectors: v0 in bech32, P2TR in bech32m, nothing else', () => {
  // github.com/bitcoin/bips/blob/master/bip-0350.mediawiki, "Test vectors for v0-v16 native segregated witness addresses".
  const valid: [string, ChainNet, string][] = [
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'mainnet', '0014751e76e8199196d454941c45d1b3a323f1433bd6'],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 'testnet', '00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262'],
    ['tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy', 'testnet', '0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433'],
    ['tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c', 'testnet', '5120000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433'],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'mainnet', '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
  ];
  for (const [address, env, script] of valid) {
    assert.equal(bytesToHex(utxoRecipientScript('btc', address, env) ?? new Uint8Array(0)), script, address);
    assert.ok(!isUtxoAddress('btc', address, env === 'mainnet' ? 'testnet' : 'mainnet'), `${address} on the other network`);
  }
  // Valid per BIP350 but witness versions/lengths no soft fork defines: refused, not burned.
  for (const address of ['bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y', 'BC1SW50QGDZ25J', 'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs']) {
    assert.ok(!isUtxoAddress('btc', address, 'mainnet'), address);
  }
  const invalid = [
    'tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut',
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
    'tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf',
    'BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL',
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',
    'tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47',
    'bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4',
    'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R',
    'bc1pw5dgrnzv',
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav',
    'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P',
    'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq',
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf',
    'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j',
    'bc1gmk9yu',
  ];
  for (const address of invalid) {
    assert.ok(!isUtxoAddress('btc', address, 'mainnet') && !isUtxoAddress('btc', address, 'testnet'), address);
  }
});

test('base58 recipients carry the network and kind in their version byte, checksum checked', () => {
  // Bitcoin: P2PKH and P2SH (the cashaddr spec's legacy column), testnet m/n and 2.
  assert.equal(bytesToHex(utxoRecipientScript('btc', '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'mainnet')!), '76a91476a04053bda0a88bda5177b86a15c3b29f55987388ac');
  assert.equal(bytesToHex(utxoRecipientScript('btc', '3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC', 'mainnet')!), 'a91476a04053bda0a88bda5177b86a15c3b29f55987387');
  assert.ok(!isUtxoAddress('btc', '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggv', 'mainnet'), 'checksum');
  assert.ok(!isUtxoAddress('btc', '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'testnet'));
  // The other networks' own versions only: a Bitcoin address is not a Litecoin, Dogecoin or Dash one.
  assert.ok(!isUtxoAddress('ltc', '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'mainnet'));
  assert.ok(!isUtxoAddress('ltc', '3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC', 'mainnet'), "Litecoin's retired 3… P2SH is refused");
  assert.ok(!isUtxoAddress('doge', ownerOf('dash'), 'mainnet'));
  assert.ok(!isUtxoAddress('dash', ownerOf('doge'), 'mainnet'));
  assert.ok(isUtxoAddress('doge', ownerOf('doge'), 'mainnet') && isUtxoAddress('dash', ownerOf('dash'), 'mainnet'));
  // The same hash under each network's P2SH version decodes to the same script there.
  const hash = hexToBytes('76a04053bda0a88bda5177b86a15c3b29f559873');
  const encode = (version: number) => {
    const payload = Uint8Array.from([version, ...hash]);
    return base58check(payload);
  };
  for (const [network, version] of [
    ['ltc', 0x32],
    ['doge', 0x16],
    ['dash', 0x10],
  ] as const) {
    assert.equal(bytesToHex(utxoRecipientScript(network, encode(version), 'mainnet')!), 'a91476a04053bda0a88bda5177b86a15c3b29f55987387', network);
  }
  // No test network for Dogecoin, Dash or Bitcoin Cash.
  assert.ok(!isUtxoAddress('doge', ownerOf('doge'), 'testnet'));
  assert.ok(!isUtxoAddress('dash', ownerOf('dash'), 'testnet'));
  assert.ok(!isUtxoAddress('bch', ownerOf('bch'), 'testnet'));
  assert.ok(!isUtxoAddress('zec' as NetworkId, ownerOf('btc'), 'mainnet'));
});


test('cashaddr spec vectors: the cashaddr and legacy forms name one script, prefix optional, one case', () => {
  // github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md, "Examples of address translation".
  const pairs = [
    ['1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'],
    ['1KXrWXciRDZUpQwQmuM1DbwsKDLYAYsVLR', 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy'],
    ['16w1D5WRVKJuZUsSRzdLp9w3YGcgoxDXb', 'bitcoincash:qqq3728yw0y47sqn6l2na30mcw6zm78dzqre909m2r'],
    ['3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC', 'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq'],
    ['3LDsS579y7sruadqu11beEJoTjdFiFCdX4', 'bitcoincash:pr95sy3j9xwd2ap32xkykttr4cvcu7as4yc93ky28e'],
    ['31nwvkZwyPdgzjBJZXfDmSWsC4ZLKpYyUw', 'bitcoincash:pqq3728yw0y47sqn6l2na30mcw6zm78dzq5ucqzc37'],
  ];
  for (const [legacy, cash] of pairs) {
    const script = utxoRecipientScript('bch', cash, 'mainnet');
    assert.ok(script, cash);
    assert.deepEqual(utxoRecipientScript('bch', legacy, 'mainnet'), script, legacy);
    assert.deepEqual(utxoRecipientScript('bch', cash.slice('bitcoincash:'.length), 'mainnet'), script, 'without the prefix');
    assert.deepEqual(utxoRecipientScript('bch', cash.toUpperCase(), 'mainnet'), script, 'upper case');
  }
  const own = ownerOf('bch');
  assert.ok(!isUtxoAddress('bch', own.slice(0, -1) + (own.endsWith('4') ? '5' : '4'), 'mainnet'), 'checksum');
  assert.ok(!isUtxoAddress('bch', `bitcoincash:${own.slice('bitcoincash:'.length).toUpperCase()}`, 'mainnet'), 'mixed case');
  // The spec's larger vectors: a 32-byte P2PKH (type 0) is no standard script; another prefix is another network.
  assert.ok(!isUtxoAddress('bch', 'bitcoincash:qvch8mmxy0rtfrlarg7ucrxxfzds5pamg73h7370aa87d80gyhqxq5nlegake', 'mainnet'));
  assert.ok(!isUtxoAddress('bch', 'bchtest:pr6m7j9njldwwzlg9v7v53unlr4jkmx6eyvwc0uz5t', 'mainnet'));
  assert.ok(!isUtxoAddress('bch', 'pref:pr6m7j9njldwwzlg9v7v53unlr4jkmx6ey65nvtks5', 'mainnet'));
  assert.equal(bytesToHex(utxoRecipientScript('bch', 'bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', 'mainnet')!), '76a914f5bf48b397dae70be82b3cca4793f8eb2b6cdac988ac');
  // A cashaddr is not a Bitcoin address, nor a Bitcoin bech32 one a Bitcoin Cash address.
  assert.ok(!isUtxoAddress('btc', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', 'mainnet'));
  assert.ok(!isUtxoAddress('bch', ownerOf('btc'), 'mainnet'));
});

test('cashaddr P2SH32 and the CashTokens-aware forms lock with the standard scripts', () => {
  // Encoded here with the spec's checksum: version byte (type << 3 | size), payload, 8 checksum words.
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  const polymod = (values: number[]) => {
    let c = 1n;
    for (const d of values) {
      const top = c >> 35n;
      c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
      GEN.forEach((g, i) => {
        if ((top >> BigInt(i)) & 1n) c ^= g;
      });
    }
    return c ^ 1n;
  };
  const toWords = (bytes: Uint8Array) => {
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const byte of bytes) {
      acc = (acc << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out.push((acc >> bits) & 31);
      }
    }
    if (bits > 0) out.push((acc << (5 - bits)) & 31);
    return out;
  };
  const encode = (version: number, hash: Uint8Array) => {
    const payload = toWords(Uint8Array.from([version, ...hash]));
    const prefix = Array.from('bitcoincash', (ch) => ch.charCodeAt(0) & 31);
    const mod = polymod([...prefix, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
    const checksum = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 31n));
    return `bitcoincash:${[...payload, ...checksum].map((w) => CHARSET[w]).join('')}`;
  };
  const h20 = hexToBytes('f5bf48b397dae70be82b3cca4793f8eb2b6cdac9');
  const h32 = hexToBytes('3173ef6623c6b48ffd1a3dcc0cc6489b0a07bb47a37f47cfef4fe69de825c060');
  assert.equal(encode(0x00, h20), 'bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', 'the encoder agrees with the spec');
  assert.equal(bytesToHex(utxoRecipientScript('bch', encode(0x0b, h32), 'mainnet')!), `aa20${bytesToHex(h32)}87`, 'P2SH32');
  assert.equal(bytesToHex(utxoRecipientScript('bch', encode(0x10, h20), 'mainnet')!), `76a914${bytesToHex(h20)}88ac`, 'token-aware P2PKH');
  assert.equal(bytesToHex(utxoRecipientScript('bch', encode(0x18, h20), 'mainnet')!), `a914${bytesToHex(h20)}87`, 'token-aware P2SH');
  assert.ok(!isUtxoAddress('bch', encode(0x03, h32), 'mainnet'), 'a 32-byte P2PKH');
  assert.ok(!isUtxoAddress('bch', encode(0x20, h20), 'mainnet'), 'an undefined type');
});

test('dust thresholds are Bitcoin Core’s per output kind, and Dogecoin’s flat 0.01 DOGE', () => {
  const s = (hex: string) => hexToBytes(hex);
  assert.equal(utxoDustOf('btc', s(`76a914${'00'.repeat(20)}88ac`)), 546n);
  assert.equal(utxoDustOf('btc', s(`a914${'00'.repeat(20)}87`)), 540n);
  assert.equal(utxoDustOf('btc', s(`0014${'00'.repeat(20)}`)), 294n);
  assert.equal(utxoDustOf('btc', s(`0020${'00'.repeat(32)}`)), 330n);
  assert.equal(utxoDustOf('btc', s(`5120${'00'.repeat(32)}`)), 330n);
  assert.equal(utxoDustOf('bch', s(`aa20${'00'.repeat(32)}87`)), 576n);
  assert.equal(utxoDustOf('doge', s(`76a914${'00'.repeat(20)}88ac`)), 1_000_000n);
});

/* ---------------------------------- Bitcoin ---------------------------------- */

const MEMPOOL = 'https://mempool.space/api';
const MEMPOOL_TEST = 'https://mempool.space/testnet4/api';

interface EsploraCoin {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
}

function esplora(api: string, o: { genesis: string; coins: EsploraCoin[]; fees?: { halfHourFee: number | string; minimumFee: number }; push?: Reply }) {
  return stub([
    [new RegExp(`^GET ${esc(api)}/block-height/0$`), () => ({ body: o.genesis })],
    [new RegExp(`^GET ${esc(api)}/address/[^/]+/utxo$`), () => json(o.coins.map((c) => ({ txid: c.txid, vout: c.vout, value: c.value, status: { confirmed: c.confirmed } })))],
    [
      new RegExp(`^GET ${esc(api)}/v1/fees/recommended$`),
      () => ({ body: `{"fastestFee":9,"halfHourFee":${o.fees?.halfHourFee ?? 5},"hourFee":3,"economyFee":2,"minimumFee":${o.fees?.minimumFee ?? 1}}` }),
    ],
    [new RegExp(`^POST ${esc(api)}/tx$`), () => o.push ?? { body: 'ok' }],
  ]);
}

const BTC_COINS: EsploraCoin[] = [
  { txid: H('aa'), vout: 0, value: 50_000, confirmed: true },
  { txid: H('bb'), vout: 1, value: 30_000, confirmed: true },
  { txid: H('cc'), vout: 2, value: 1_000_000, confirmed: false },
];
const P2TR = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

/** Every witness input of `raw` signs the BIP143 digest of `values` with our key. */
function checkSegwitSignatures(raw: string, values: bigint[], secret: Uint8Array) {
  const { tx, witnesses } = parseTx(raw);
  const pub = secp256k1.getPublicKey(secret, true);
  tx.inputs.forEach((_, i) => {
    const [sig, key] = witnesses[i];
    assert.deepEqual(key, pub);
    assert.equal(sig[sig.length - 1], 0x01);
    assert.ok(verifies(sig, bip143Sighash(tx, i, p2pkhScript(hash160(pub)), values[i], 1), pub), `input ${i}`);
  });
}

test('a Bitcoin send spends confirmed coins, pays the recipient, keeps the change and relays as text/plain', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  const p = transfer('btc', P2TR, 60_000n, { maxFee: 30_000n });
  const txid = await sendUtxo(p);

  const [push] = posted(calls);
  assert.equal(push.url, `${MEMPOOL}/tx`);
  assert.equal(push.type, 'text/plain');
  const { tx, scriptSigs } = parseTx(push.body!);
  assert.equal(txid, txidOf(tx, scriptSigs));
  assert.equal(tx.version, 2);
  assert.equal(tx.locktime, 0);
  // The two confirmed coins, largest first; the unconfirmed million is not touched.
  assert.deepEqual(
    tx.inputs.map((i) => [i.txid, i.vout, i.sequence]),
    [
      [H('aa'), 0, 0xfffffffd],
      [H('bb'), 1, 0xfffffffd],
    ],
  );
  assert.equal(bytesToHex(tx.outputs[0].script), '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.equal(tx.outputs[0].value, 60_000n);
  assert.deepEqual(tx.outputs[1].script, utxoRecipientScript('btc', p.owner, 'mainnet'));
  // 2 P2WPKH inputs, a P2TR and a P2WPKH output: at most 221 vB, at 5 sat/vB.
  assert.equal(80_000n - 60_000n - tx.outputs[1].value, 1_105n);
  checkSegwitSignatures(push.body!, [50_000n, 30_000n], p.secret);
  // The identity check came first, alone.
  assert.match(calls[0].url, /\/block-height\/0$/);
});

test('a Bitcoin API answering another genesis is refused before anything else is asked', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.testnet, coins: BTC_COINS });
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 60_000n))), 'chain');
  assert.equal(calls.length, 1);
});

test('a fee past maxFee is refused, not paid — whether the coins could cover it or not', async () => {
  let calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS, fees: { halfHourFee: 100, minimumFee: 1 } });
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 10_000n, { maxFee: 5_000n }))), 'fee');
  assert.equal(posted(calls).length, 0);
  // At 500 sat/vB the coins no longer cover amount + fee; the fee is still the reason.
  calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS, fees: { halfHourFee: 500, minimumFee: 1 } });
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 60_000n, { maxFee: 30_000n }))), 'fee');
  assert.equal(posted(calls).length, 0);
});

test('more than the confirmed coins cover is refused as funds; unconfirmed coins do not count', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 79_500n, { maxFee: 30_000n }))), 'funds');
  assert.equal(posted(calls).length, 0);
});

test('a fractional fee rate is read exactly and rounded up; below the relay floor it is the floor', async () => {
  let calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS, fees: { halfHourFee: '2.5', minimumFee: 1 } });
  await sendUtxo(transfer('btc', P2TR, 40_000n));
  let { tx } = parseTx(posted(calls)[0].body!);
  // One 50 000 input, P2TR + change: at most 153 vB → ceil(153 × 2.5) = 383.
  assert.equal(50_000n - 40_000n - tx.outputs[1].value, 383n);
  calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS, fees: { halfHourFee: '0.2', minimumFee: 0 } });
  await sendUtxo(transfer('btc', P2TR, 40_000n));
  ({ tx } = parseTx(posted(calls)[0].body!));
  assert.equal(50_000n - 40_000n - tx.outputs[1].value, 153n, '1 sat/vB floor');
});

test('change below its dust threshold is left to the fee instead of written', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  // 50 000 − 49 000 leaves 1 000; a change output (153 vB at 5) would leave 235, under P2WPKH's 294.
  await sendUtxo(transfer('btc', P2TR, 49_000n));
  const { tx } = parseTx(posted(calls)[0].body!);
  assert.equal(tx.outputs.length, 1);
  assert.equal(tx.outputs[0].value, 49_000n);
});

test('refusals that need no node: a token, a memo, a foreign recipient, dust — nothing is fetched', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 60_000n, { asset: 'USDC' }))), 'address');
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 60_000n, { memo: 'hi' }))), 'memo');
  assert.equal(await refusal(sendUtxo(transfer('btc', ownerOf('ltc'), 60_000n))), 'address');
  assert.equal(await refusal(sendUtxo(transfer('btc', 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 60_000n))), 'address');
  assert.equal(await refusal(sendUtxo(transfer('btc', ownerOf('btc'), 293n))), 'minimum');
  assert.equal(await refusal(sendUtxo(transfer('btc', '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu', 545n))), 'minimum');
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 0n))), 'minimum');
  assert.equal(await refusal(sendUtxo({ ...transfer('btc', P2TR, 60_000n), network: 'eth' })), 'chain');
  assert.equal(calls.length, 0);
});

test('a key that does not control the owner address is an error, never a payment', async () => {
  const calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  const p = { ...transfer('btc', P2TR, 60_000n), secret: secretOf('ltc') };
  assert.match((await refusal(sendUtxo(p))) ?? '', /does not control/);
  assert.equal(calls.length, 0);
});

test('a relay the API refuses is an error naming its code, not its text', async () => {
  esplora(MEMPOOL, {
    genesis: ESPLORA_GENESIS_HASH.btc.mainnet,
    coins: BTC_COINS,
    push: { status: 400, body: 'sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met"}' },
  });
  const message = (await refusal(sendUtxo(transfer('btc', P2TR, 60_000n)))) ?? '';
  assert.match(message, /HTTP 400, code -26/);
  assert.doesNotMatch(message, /relay fee/);
});

test('Bitcoin Testnet4: its own genesis, tb1 addresses, and a mainnet recipient refused', async () => {
  const to = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
  let calls = esplora(MEMPOOL_TEST, { genesis: ESPLORA_GENESIS_HASH.btc.testnet, coins: BTC_COINS });
  const p = transfer('btc', to, 60_000n, { env: 'testnet' });
  assert.equal(p.def.balance?.kind === 'esplora' && p.def.balance.api, MEMPOOL_TEST);
  await sendUtxo(p);
  assert.equal(posted(calls)[0].url, `${MEMPOOL_TEST}/tx`);
  checkSegwitSignatures(posted(calls)[0].body!, [50_000n, 30_000n], p.secret);

  calls = esplora(MEMPOOL_TEST, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  assert.equal(await refusal(sendUtxo(transfer('btc', to, 60_000n, { env: 'testnet' }))), 'chain');
  assert.equal(posted(calls).length, 0);
  assert.equal(await refusal(sendUtxo(transfer('btc', P2TR, 60_000n, { env: 'testnet' }))), 'address');
});

/* ---------------------------------- Litecoin ---------------------------------- */

test('a Litecoin send is the same P2WPKH transaction under its own genesis and addresses', async () => {
  const api = 'https://litecoinspace.org/api';
  const calls = esplora(api, { genesis: ESPLORA_GENESIS_HASH.ltc.mainnet, coins: BTC_COINS });
  const p = transfer('ltc', ownerOf('ltc'), 60_000n);
  await sendUtxo(p);
  checkSegwitSignatures(posted(calls)[0].body!, [50_000n, 30_000n], p.secret);

  esplora(api, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: BTC_COINS });
  assert.equal(await refusal(sendUtxo(transfer('ltc', ownerOf('ltc'), 60_000n))), 'chain');
  esplora('https://litecoinspace.org/testnet/api', { genesis: ESPLORA_GENESIS_HASH.ltc.testnet, coins: BTC_COINS });
  await sendUtxo(transfer('ltc', ownerOf('ltc', 'testnet'), 60_000n, { env: 'testnet' }));
});

/* --------------------------------- Dogecoin, Dash -------------------------------- */

/** A previous transaction holding `value` locked by `script` at output `vout`: its raw bytes and real txid. */
function previousTx(vout: number, value: bigint, script: Uint8Array, salt: string) {
  const filler = { value: 1n, script: hexToBytes(`76a914${'22'.repeat(20)}88ac`) };
  const tx: Tx = {
    version: 1,
    inputs: [{ txid: H(salt), vout: 0, sequence: 0xffffffff }],
    outputs: [...Array.from({ length: vout }, () => filler), { value, script }],
    locktime: 0,
  };
  const scriptSigs = [Uint8Array.of(0x51)];
  return { txid: txidOf(tx, scriptSigs), hex: bytesToHex(serializeTx(tx, scriptSigs)) };
}

interface Listed {
  refs: Record<string, unknown>[];
  /** The raw previous transactions by txid, as BlockCypher's `includeHex` answers them. */
  raw: Map<string, string>;
}

function blockcypher(coin: 'doge' | 'dash', o: { name: string; medium: number; listed: Listed; hasMore?: boolean }) {
  const base = `https://api.blockcypher.com/v1/${coin}/main`;
  return stub([
    [new RegExp(`^GET ${esc(base)}$`), () => json({ name: o.name, height: 1, high_fee_per_kb: o.medium * 4, medium_fee_per_kb: o.medium, low_fee_per_kb: 1 })],
    [new RegExp(`^GET ${esc(base)}/addrs/[^?]+\\?unspentOnly=true&includeScript=true&limit=2000$`), () => json({ txrefs: o.listed.refs, hasMore: o.hasMore ?? false })],
    [
      new RegExp(`^GET ${esc(base)}/txs/[0-9a-f]{64}\\?includeHex=true&limit=1$`),
      (c) => {
        const txid = /txs\/([0-9a-f]{64})/.exec(c.url)![1];
        const hex = o.listed.raw.get(txid);
        return hex === undefined ? { status: 404, body: '{"error":"not found"}' } : json({ hash: txid, hex });
      },
    ],
    [new RegExp(`^POST ${esc(base)}/txs/push$`), () => ({ status: 201, body: '{"tx":{"hash":"x"}}' })],
  ]);
}

/**
 * Our coins as BlockCypher lists them, each backed by a real previous transaction: one confirmed
 * 5-coin output (the one spent), and three that must never be — unconfirmed, someone else's
 * script, already spent.
 */
function legacyListing(network: 'doge' | 'dash', tamper: { listedValue?: bigint; rawScript?: Uint8Array; rawHex?: string } = {}): Listed {
  const own = utxoRecipientScript(network, ownerOf(network), 'mainnet')!;
  const spendable = previousTx(2, 500_000_000n, tamper.rawScript ?? own, 'e1');
  const unconfirmed = previousTx(3, 900_000_000n, own, 'e2');
  const foreign = previousTx(1, 900_000_000n, hexToBytes(`76a914${'11'.repeat(20)}88ac`), 'e3');
  const spent = previousTx(1, 900_000_000n, own, 'e4');
  const ownHex = bytesToHex(own);
  return {
    refs: [
      { tx_hash: spendable.txid, tx_output_n: 2, tx_input_n: -1, value: Number(tamper.listedValue ?? 500_000_000n), confirmations: 10, script: ownHex },
      { tx_hash: unconfirmed.txid, tx_output_n: 3, tx_input_n: -1, value: 900_000_000, confirmations: 0, script: ownHex },
      { tx_hash: foreign.txid, tx_output_n: 1, tx_input_n: -1, value: 900_000_000, confirmations: 5, script: `76a914${'11'.repeat(20)}88ac` },
      { tx_hash: spent.txid, tx_output_n: 1, tx_input_n: -1, value: 900_000_000, confirmations: 5, script: ownHex, spent: true },
    ],
    raw: new Map([
      [spendable.txid, tamper.rawHex ?? spendable.hex],
      [unconfirmed.txid, unconfirmed.hex],
      [foreign.txid, foreign.hex],
      [spent.txid, spent.hex],
    ]),
  };
}
const spendableTxid = (listed: Listed) => listed.refs[0].tx_hash as string;

/** Every P2PKH input of `raw` signs `digest(tx, i)` with our key. */
function checkP2pkhSignatures(raw: string, secret: Uint8Array, hashType: number, digest: (tx: Tx, i: number, script: Uint8Array) => Uint8Array) {
  const { tx, scriptSigs } = parseTx(raw);
  const pub = secp256k1.getPublicKey(secret, true);
  const script = p2pkhScript(hash160(pub));
  scriptSigs.forEach((s, i) => {
    const { sig, pub: key } = splitScriptSig(s);
    assert.deepEqual(key, pub);
    assert.equal(sig[sig.length - 1], hashType);
    assert.ok(verifies(sig, digest(tx, i, script), pub), `input ${i}`);
  });
  return tx;
}

const NO_PACE = 0;

test('a Dogecoin send: legacy P2PKH, the chain named DOGE.main, only our confirmed unspent coins, each proved by its previous transaction', async () => {
  const listed = legacyListing('doge');
  const calls = blockcypher('doge', { name: 'DOGE.main', medium: 48_497_089, listed });
  const to = 'DSP4tRb1gSftwfTXu9t2CKbeymGMnPVY3T';
  const p = transfer('doge', to, 480_000_000n, { maxFee: 500_000_000n });
  const txid = await sendUtxo(p, NO_PACE);
  // The chain, the coins, the one previous transaction spent from, the relay — in that order.
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace(/^https:\/\/api\.blockcypher\.com\/v1\/doge\/main/, '').replace(/\?.*$/, '')}`),
    ['GET ', `GET /addrs/${ownerOf('doge')}`, `GET /txs/${spendableTxid(listed)}`, 'POST /txs/push'],
  );
  const [push] = posted(calls);
  assert.equal(push.type, 'application/json');
  const raw = (JSON.parse(push.body!) as { tx: string }).tx;
  const tx = checkP2pkhSignatures(raw, p.secret, 0x01, (t, i, s) => legacySighash(t, i, s, 1));
  assert.equal(txid, txidOf(tx, parseTx(raw).scriptSigs));
  assert.equal(tx.version, 1);
  assert.deepEqual(
    tx.inputs.map((i) => [i.txid, i.vout, i.sequence]),
    [[spendableTxid(listed), 2, 0xffffffff]],
  );
  assert.equal(tx.outputs[0].value, 480_000_000n);
  // 1 input, 2 P2PKH outputs: at most 226 bytes at 0.48497089 DOGE/kB.
  assert.equal(500_000_000n - 480_000_000n - tx.outputs[1].value, 10_960_343n);
});

test('Dogecoin and Dash sign no input value: a listing that misstates one is refused, nothing signed or relayed', async () => {
  const own = utxoRecipientScript('doge', ownerOf('doge'), 'mainnet')!;
  /** The listing as is, except that the coin spent comes from `real` (its true txid and bytes). */
  const relisted = (real: { txid: string; hex: string }): Listed => {
    const listed = legacyListing('doge');
    listed.raw.delete(spendableTxid(listed));
    listed.refs[0].tx_hash = real.txid;
    listed.raw.set(real.txid, real.hex);
    return listed;
  };
  const cases: [string, Listed][] = [
    // Listed at 5 DOGE, held at 50: signing would hand the other 45 to miners.
    ['a value under the real one', relisted(previousTx(2, 5_000_000_000n, own, 'e1'))],
    ['a value over the real one', relisted(previousTx(2, 400_000_000n, own, 'e1'))],
    ['bytes that hash to another txid', legacyListing('doge', { rawHex: previousTx(2, 500_000_000n, own, 'f0').hex })],
    ['an output locked to someone else', legacyListing('doge', { rawScript: hexToBytes(`76a914${'33'.repeat(20)}88ac`) })],
    // A real transaction with outputs 0 and 1 only, listed as holding output 2.
    ['no such output', relisted(previousTx(1, 500_000_000n, own, 'e1'))],
    ['bytes that are no transaction', legacyListing('doge', { rawHex: 'zz' })],
  ];
  for (const [what, listed] of cases) {
    const calls = blockcypher('doge', { name: 'DOGE.main', medium: 1_000_000, listed });
    assert.equal(await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 100_000_000n), NO_PACE)), 'chain', what);
    assert.equal(posted(calls).length, 0, what);
  }
});

test('Dogecoin: change under 0.01 DOGE goes to the fee; a payment under 0.01 DOGE is refused', async () => {
  let calls = blockcypher('doge', { name: 'DOGE.main', medium: 48_497_089, listed: legacyListing('doge') });
  await sendUtxo(transfer('doge', ownerOf('doge'), 488_500_000n, { maxFee: 500_000_000n }), NO_PACE);
  const raw = (JSON.parse(posted(calls)[0].body!) as { tx: string }).tx;
  assert.equal(parseTx(raw).tx.outputs.length, 1);
  calls = blockcypher('doge', { name: 'DOGE.main', medium: 48_497_089, listed: legacyListing('doge') });
  assert.equal(await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 999_999n), NO_PACE)), 'minimum');
  assert.equal(calls.length, 0);
});

test('BlockCypher naming another chain is refused; a listing it says is partial is never read as the balance', async () => {
  let calls = blockcypher('doge', { name: 'LTC.main', medium: 1_000_000, listed: legacyListing('doge') });
  assert.equal(await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 100_000_000n), NO_PACE)), 'chain');
  assert.equal(calls.length, 1);
  calls = blockcypher('doge', { name: 'DOGE.main', medium: 1_000_000, listed: legacyListing('doge'), hasMore: true });
  assert.match((await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 600_000_000n), NO_PACE))) ?? '', /more coins/);
  assert.equal(posted(calls).length, 0);
  calls = blockcypher('doge', { name: 'DOGE.main', medium: 1_000_000, listed: legacyListing('doge') });
  assert.equal(await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 600_000_000n), NO_PACE)), 'funds');
  assert.equal(posted(calls).length, 0);
  // A fee past the cap is refused before any previous transaction is fetched.
  calls = blockcypher('doge', { name: 'DOGE.main', medium: 48_497_089, listed: legacyListing('doge') });
  assert.equal(await refusal(sendUtxo(transfer('doge', ownerOf('doge'), 100_000_000n, { maxFee: 1_000_000n }), NO_PACE)), 'fee');
  assert.equal(calls.length, 2);
});

test('BlockCypher requests are spaced by the pace, under its keyless rate', async () => {
  const times: number[] = [];
  const calls = blockcypher('doge', { name: 'DOGE.main', medium: 1_000_000, listed: legacyListing('doge') });
  const stubbed = globalThis.fetch;
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    times.push(Date.now());
    return stubbed(input, init);
  }) as typeof fetch;
  await sendUtxo(transfer('doge', ownerOf('doge'), 100_000_000n), 40);
  assert.equal(calls.length, 4);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 35, `request ${i} came ${times[i] - times[i - 1]} ms after the last`);
});

test('a Dash send: legacy P2PKH under DASH.main; Dash has no test network here', async () => {
  const calls = blockcypher('dash', { name: 'DASH.main', medium: 18_014, listed: legacyListing('dash') });
  const p = transfer('dash', ownerOf('dash'), 100_000_000n, { maxFee: 100_000n });
  await sendUtxo(p, NO_PACE);
  const raw = (JSON.parse(posted(calls)[0].body!) as { tx: string }).tx;
  const tx = checkP2pkhSignatures(raw, p.secret, 0x01, (t, i, s) => legacySighash(t, i, s, 1));
  assert.equal(tx.version, 2);
  assert.equal(500_000_000n - 100_000_000n - tx.outputs[1].value, 4_072n);
  const none = stub([]);
  assert.equal(await refusal(sendUtxo({ ...transfer('dash', ownerOf('dash'), 100_000_000n), env: 'testnet' }, NO_PACE)), 'chain');
  assert.equal(none.length, 0);
});

/* ---------------------------------- Bitcoin Cash --------------------------------- */

function bitcore(o: { checkpoint?: object; coins: object[]; feerate?: string }) {
  return stub([
    [new RegExp(`^GET ${esc(BCH_BITCORE_API)}/block/${BCH_CHECKPOINT.height}$`), () => json(o.checkpoint ?? { chain: 'BCH', network: 'mainnet', hash: BCH_CHECKPOINT.hash, height: BCH_CHECKPOINT.height })],
    [new RegExp(`^GET ${esc(BCH_BITCORE_API)}/address/q[0-9a-z]+/\\?unspent=true&limit=1000$`), () => json(o.coins)],
    [new RegExp(`^GET ${esc(BCH_BITCORE_API)}/fee/2$`), () => ({ body: `{"feerate":${o.feerate ?? '0.00001'}}` })],
    [new RegExp(`^POST ${esc(BCH_BITCORE_API)}/tx/send$`), () => json({ txid: 'x' })],
  ]);
}

function bchCoins() {
  const own = bytesToHex(utxoRecipientScript('bch', ownerOf('bch'), 'mainnet')!);
  return [
    { mintTxid: H('b1'), mintIndex: 0, value: 1_000_000, script: own, mintHeight: 900_000, spentHeight: -2 },
    { mintTxid: H('b2'), mintIndex: 1, value: 9_000_000, script: own, mintHeight: -1, spentHeight: -2 },
    { mintTxid: H('b3'), mintIndex: 2, value: 9_000_000, script: own, mintHeight: 900_001, spentHeight: -1 },
  ];
}

test('a Bitcoin Cash send signs with SIGHASH_ALL|FORKID over the input values, through Bitcore', async () => {
  const calls = bitcore({ coins: bchCoins() });
  const p = transfer('bch', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', 500_000n, { maxFee: 10_000n });
  const txid = await sendUtxo(p);
  // Bitcore spells a cashaddr without its prefix.
  assert.ok(calls.some((c) => c.url.includes(`/address/${ownerOf('bch').slice('bitcoincash:'.length)}/`)));
  const [push] = posted(calls);
  assert.equal(push.type, 'application/json');
  const raw = (JSON.parse(push.body!) as { rawTx: string }).rawTx;
  const tx = checkP2pkhSignatures(raw, p.secret, 0x41, (t, i, s) => bip143Sighash(t, i, s, 1_000_000n, 0x41));
  assert.equal(txid, txidOf(tx, parseTx(raw).scriptSigs));
  assert.deepEqual(
    tx.inputs.map((i) => [i.txid, i.vout]),
    [[H('b1'), 0]],
  );
  assert.equal(bytesToHex(tx.outputs[0].script), '76a91476a04053bda0a88bda5177b86a15c3b29f55987388ac');
  // 226 bytes at 1 sat/B.
  assert.equal(1_000_000n - 500_000n - tx.outputs[1].value, 226n);
  // The signature is not a Bitcoin one: the legacy digest does not verify.
  const { sig, pub } = splitScriptSig(parseTx(raw).scriptSigs[0]);
  assert.ok(!verifies(sig, legacySighash(tx, 0, p2pkhScript(hash160(pub)), 0x01), pub));
});

test('a Bitcoin Cash API off the chain (Bitcoin SV, eCash, Bitcoin) is refused before coins or fees are asked', async () => {
  for (const checkpoint of [
    { chain: 'BCH', network: 'mainnet', hash: H('00'), height: BCH_CHECKPOINT.height },
    { chain: 'BTC', network: 'mainnet', hash: BCH_CHECKPOINT.hash, height: BCH_CHECKPOINT.height },
    { chain: 'BCH', network: 'testnet', hash: BCH_CHECKPOINT.hash, height: BCH_CHECKPOINT.height },
  ]) {
    const calls = bitcore({ checkpoint, coins: bchCoins() });
    assert.equal(await refusal(sendUtxo(transfer('bch', ownerOf('bch'), 500_000n))), 'chain');
    assert.equal(calls.length, 1);
  }
});

test('Bitcoin Cash: no estimate (-1) pays the floor; mempool and spent coins are not spendable', async () => {
  let calls = bitcore({ coins: bchCoins(), feerate: '-1' });
  await sendUtxo(transfer('bch', ownerOf('bch'), 500_000n));
  const raw = (JSON.parse(posted(calls)[0].body!) as { rawTx: string }).rawTx;
  assert.equal(1_000_000n - 500_000n - parseTx(raw).tx.outputs[1].value, 226n);
  calls = bitcore({ coins: bchCoins() });
  assert.equal(await refusal(sendUtxo(transfer('bch', ownerOf('bch'), 1_000_000n))), 'funds');
  assert.equal(posted(calls).length, 0);
});

/* ------------------------- transactions the nodes decoded ------------------------- */

// Built by sendUtxo from the fixtures below and handed, 2026-10-29, to the networks' own nodes
// WITHOUT broadcasting: Bitcoin to mempool.space POST /api/txs/test (testmempoolaccept: standard,
// rejected only for 'missing-inputs' — the fixture coin does not exist), Litecoin, Dogecoin and
// Dash to BlockCypher POST /txs/decode on their chains, Bitcoin Cash to BlockCypher Bitcoin decode
// (the same legacy wire format). Each node computed the txid pinned beside the bytes. RFC 6979
// makes the signatures deterministic, so the same fixtures must give the same bytes.
const DECODED = {
  btc: { txid: 'f6b9ca9ef9cd389e5de1f1286a671403792ca756365a5723d8b0a33e3ae48546', raw: '02000000000101abababababababababababababababababababababababababababababababab0100000000fdffffff02a08601000000000022512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798be480200000000001600140612a9ff14d94ab6fe4a0d31d3ef61b25504a94f02473044022076fc495918bcbb6cc9dbc6508e493b17d95bb2a90c1fdc695cbf92e6ed73b26a0220029e09384014eb36faf789ae2e994fe481d2d450b6ea6fd7e67ddfbb5fb5f5700121036e5c09d1b1dccc3c7912ee7295a7f9f5cbc81f90a7b1975b12e1b1e7023fdc8900000000' },
  ltc: { txid: '22e71b08a0a1098ef55c4eeb86e13f0abcf60e415a2ec13041294485f9378ca9', raw: '02000000000101abababababababababababababababababababababababababababababababab0100000000fdffffff02a08601000000000017a914b48297bff5dadecc5f36145cec6a5f20d57c8f9b87d4480200000000001600141718b6d7b445565525004267a4f656f7c54b5fdd0247304402203e419abe5bdcfeb2568a5260761ff88fd70629bff466c3591e7f55d4e0703dfd022017a559b1de26734f3a7a8af7b320979e17a9b3a2dbdfed14abe0304047e06ae80121029651513dabeddd8d66691bf3c7f7b5bb5508e3fb2e79ff33910b7def322bd42700000000' },
  doge: { txid: '7ea8e8e2be810e6f7b9f54280f5ab4bb186db28d18fe5625034b1d53ed525ae5', raw: '01000000014676266b03834eb888d80f8f0a1ac358e9352d8da26f8ab1aea369915e0f5317000000006b483045022100ddd031dd9f3375d3e4e5e8670d52d1bdb5270a4de864e53cf48b229775397a5202202742ef4a409b8f90a1e68985d9e0a7b955392205a8df33959b38b589f927beaf0121026eddf496c82aaefb0a7ba01b8a652f9e874bdbc39fee462f4bc20654085237a1ffffffff0200a3e111000000001976a914e8ff15ed1b37d01e4fc6e4c768e7dafe0cd5bc8a88ac30b4b529000000001976a9143f23d15707facab708c9aacc75f0e47dfd2e4a8388ac00000000' },
  dash: { txid: 'd3bb6617371da12b96840458def2d6d82fabcf31d31466a4b4f5e2146a0c3bbf', raw: '020000000150710be949a19381319b5defa1353ba36cd92c7ef307c021e19e8a025005f0ff000000006a47304402201e79e6c791b331b158e4d9cee680938ee9f442d09fa69b4004044964f77b6c4e022058a6cf76d58dc60254df475baefac072579e26e130c0b682d4c8f7b6e30dd2230121022cdd0e2bdc7a2e50861b19a67cecb758a7cc9c751f6c89a969b8c14d5dc55167ffffffff0280c3c901000000001976a91422e00aa6ae9de07a001c5300d6211e924837bfbc88ac9e1c2c04000000001976a91422e00aa6ae9de07a001c5300d6211e924837bfbc88ac00000000' },
  bch: { txid: 'd760bda858ba37ea68cd03be15ff65c1d87875f79a76b7f923e666feca5e8350', raw: '0200000001cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd000000006a4730440220604f5ffcd128ce73f97a19e2d76211eeb9d9f73cf726662a1e0e94de7c55462b0220594ec23482fe833a53ed0c543d069cb94116ab80ba5605e9d7afcff642b5685541210394da68d5d73c9c8ee774443190cd9f25bf715d6a2a0398032eb85ae23aeec753ffffffff02e0930400000000001976a91476a04053bda0a88bda5177b86a15c3b29f55987388ac7ead0a00000000001976a9140b73d499e95915eae89a28d26c1b6bcc5a864e0688ac00000000' },
};

test('the transactions the networks’ nodes decoded are what the sender still builds, byte for byte', async () => {
  const sent = async (calls: Call[], p: ReturnType<typeof transfer>) => {
    const txid = await sendUtxo(p, NO_PACE);
    const body = posted(calls)[0].body!;
    const raw = body.startsWith('{') ? ((JSON.parse(body) as { tx?: string; rawTx?: string }).tx ?? (JSON.parse(body) as { rawTx: string }).rawTx) : body;
    return { txid, raw };
  };
  const coin = { txid: H('ab'), vout: 1, value: 250_000, confirmed: true };
  const fees = { halfHourFee: 2, minimumFee: 1 };
  let calls = esplora(MEMPOOL, { genesis: ESPLORA_GENESIS_HASH.btc.mainnet, coins: [coin], fees });
  assert.deepEqual(await sent(calls, transfer('btc', P2TR, 100_000n)), DECODED.btc);
  calls = esplora('https://litecoinspace.org/api', { genesis: ESPLORA_GENESIS_HASH.ltc.mainnet, coins: [coin], fees });
  assert.deepEqual(await sent(calls, transfer('ltc', 'MQMcJhpWHYVeQArcZR3sBgyPZxxRtnH441', 100_000n)), DECODED.ltc);

  const oneCoin = (network: 'doge' | 'dash', value: bigint): Listed => {
    const own = utxoRecipientScript(network, ownerOf(network), 'mainnet')!;
    const prev = previousTx(0, value, own, '11');
    return {
      refs: [{ tx_hash: prev.txid, tx_output_n: 0, tx_input_n: -1, value: Number(value), confirmations: 3, script: bytesToHex(own) }],
      raw: new Map([[prev.txid, prev.hex]]),
    };
  };
  calls = blockcypher('doge', { name: 'DOGE.main', medium: 1_000_000, listed: oneCoin('doge', 1_000_000_000n) });
  assert.deepEqual(await sent(calls, transfer('doge', 'DSP4tRb1gSftwfTXu9t2CKbeymGMnPVY3T', 300_000_000n)), DECODED.doge);
  calls = blockcypher('dash', { name: 'DASH.main', medium: 1_000, listed: oneCoin('dash', 100_000_000n) });
  assert.deepEqual(await sent(calls, transfer('dash', ownerOf('dash'), 30_000_000n)), DECODED.dash);

  const own = bytesToHex(utxoRecipientScript('bch', ownerOf('bch'), 'mainnet')!);
  calls = bitcore({ coins: [{ mintTxid: H('cd'), mintIndex: 0, value: 1_000_000, script: own, mintHeight: 900_000, spentHeight: -2 }] });
  assert.deepEqual(await sent(calls, transfer('bch', 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', 300_000n)), DECODED.bch);
});
