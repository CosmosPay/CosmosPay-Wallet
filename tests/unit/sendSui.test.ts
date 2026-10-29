/**
 * Paying on Sui (src/lib/send/sui.ts), against a stubbed GraphQL service. Pinned: the BCS, the
 * signature and the digest against published vectors and transactions that executed on Sui
 * mainnet; how a transfer is composed from coin objects and the address balance; and every
 * refusal — a service of another network, an address with nothing, an amount or a budget the
 * holdings cannot carry, a fee past the cap, a failed simulation, a recipient or a coin type the
 * screen never offered — with nothing executed.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';
import { NETWORKS } from '@/constants/networks';
import { SUI_CHAIN_ID, SUI_COIN_TYPE } from '@/constants/suiSend';
import {
  isSuiAddress,
  planSuiTransfer,
  sendSui,
  signSuiTx,
  suiAddressOf,
  suiSigningMessage,
  suiTxBytes,
  suiTxDigest,
  type SuiCoin,
  type SuiPlanInput,
  type SuiTransaction,
} from '@/lib/send/sui';
import type { FamilyTransfer } from '@/lib/send/types';
import { networkDefOn } from '@/lib/testnets';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const USDC = NETWORKS.sui.tokens[0].asset;
const MAINNET = SUI_CHAIN_ID.mainnet;

/* ------------------------------ published vectors ------------------------------ */

test('a coin-gas SUI transfer serializes and signs as Trust Wallet’s vector', () => {
  // wallet-core tests/chains/Sui/SignerTests.cpp (SuiSigner.Transfer): SplitCoins(GasCoin) + TransferObjects.
  const sender = '0xd575ad7f18e948462a5cf698f564ef394a752a71fec62493af8a055c012c0d50';
  const tx: SuiTransaction = {
    sender,
    inputs: [{ pure: hexToBytes('1027000000000000') }, { pure: hexToBytes('259ff8074ab425cbb489f236e18e08f03f1a7856bdf7c7a2877bd64f738b5015') }],
    commands: [{ split: { coin: { gas: true }, amounts: [{ input: 0 }] } }, { transfer: { objects: [{ nested: [0, 0] }], to: { input: 1 } } }],
    gas: {
      payment: [
        {
          id: '0x06f2c2c8c1d8964df1019d6616e9705719bebabd931da2755cb948ceb7e68964',
          version: 748n,
          // The API writes object digests base58; the vector's bytes are this hex.
          digest: base58.encode(hexToBytes('60456ec667f5cd10467680ebf950ed329205175dacd946bb236aeed57c8617cf')),
        },
      ],
      owner: sender,
      price: 1n,
      budget: 2000n,
    },
    expiration: { none: true },
  };
  const bytes = suiTxBytes(tx);
  assert.equal(
    base64.encode(bytes),
    'AAACAAgQJwAAAAAAAAAgJZ/4B0q0Jcu0ifI24Y4I8D8aeFa998eih3vWT3OLUBUCAgABAQAAAQEDAAAAAAEBANV1rX8Y6UhGKlz2mPVk7zlKdSpx/sYkk6+KBVwBLA1QAQbywsjB2JZN8QGdZhbpcFcZvrq9kx2idVy5SM635olk7AIAAAAAAAAgYEVuxmf1zRBGdoDr+VDtMpIFF12s2Ua7I2ru1XyGF8/Vda1/GOlIRipc9pj1ZO85SnUqcf7GJJOvigVcASwNUAEAAAAAAAAA0AcAAAAAAAAA',
  );
  const { signature } = signSuiTx(bytes, hexToBytes('3823dce5288ab55dd1c00d97e91933c613417fdb282a0b8b01a7f5f5a533b266'));
  assert.equal(signature, 'APxPduNVvHj2CcRcHOtiP2aBR9qP3vO2Cb0g12PI64QofDB6ks33oqe/i/iCTLcop2rBrkczwrayZuJOdi7gvwNqfN7sFqdcD/Z4e8I1YQlGkDMCK7EOgmydRDqfH8C9jg==');
});

// wallet-core rust/tw_tests/tests/chains/sui/{test_cases.rs, sui_sign_address_balance.rs}.
const TW_KEY = '7e6682f7bf479ef0f627823cffd4e1a940a7af33e5fb39d9e0f631d2ecc5daff';
const TW_SENDER = '0x54e80d76d790c277f5a44f3ce92f53d26f5894892bf395dee6375988876be6b2';
const TW_RECIPIENT = '0xa7175abdd5ed92ebe3ad390db366c6a706478cdf517cde6cf98630065cda377a';

const plan = (over: Partial<SuiPlanInput>): SuiTransaction => {
  const tx = planSuiTransfer({
    sender: TW_SENDER,
    to: TW_RECIPIENT,
    amount: 1n,
    coinType: SUI_COIN_TYPE,
    sui: { coins: [], addressBalance: 0n },
    token: { coins: [], addressBalance: 0n },
    price: 100n,
    budget: 5_000_000n,
    epoch: 1288n,
    chain: MAINNET,
    nonce: 12345,
    ...over,
  });
  assert.ok(tx, 'a plan');
  return tx;
};

test('a transfer from the address balance (SIP-58) is planned, serialized and signed as Trust Wallet’s vectors', () => {
  const seed = hexToBytes(TW_KEY);
  assert.equal(suiAddressOf(ed25519.getPublicKey(seed)), TW_SENDER);
  // SUI, gas from the address balance too.
  const sui = suiTxBytes(plan({ amount: 1_000_000_000n, sui: { coins: [], addressBalance: 2_000_000_000n } }));
  assert.equal(
    base64.encode(sui),
    'AAACAgAAypo7AAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIDc3VpA1NVSQAAACCnF1q91e2S6+OtOQ2zZsanBkeM31F83mz5hjAGXNo3egIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIEY29pbgxyZWRlZW1fZnVuZHMBBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA3N1aQNTVUkAAQEAAAEBAgAAAQEAVOgNdteQwnf1pE886S9T0m9YlIkr85Xe5jdZiIdr5rIAVOgNdteQwnf1pE886S9T0m9YlIkr85Xe5jdZiIdr5rJkAAAAAAAAAEBLTAAAAAAAAgEIBQAAAAAAAAEJBQAAAAAAAAAAIDWDSorBfKSPsUrI+ZwXyYdH6V3QcpSuQaRrOCJGpEmbOTAAAA==',
  );
  assert.equal(
    signSuiTx(sui, seed).signature,
    'AL0Td0eKAdFam0WCkSO240Q0Mc5evlwFj5Sr4D8w1TGxtEHoJ2hzWcsytyIIgzhdFjyUgEtPoCHQvXOOCkq5/Q2F69FEH+T5VPvl3GB3vwCOEZpeJpKXxvcIPQAdKsh2/g==',
  );
  // USDC, redeemed with redeem_funds<USDC>, gas from the SUI address balance.
  const usdc = suiTxBytes(
    plan({ amount: 7_000_000n, coinType: USDC, sui: { coins: [], addressBalance: 10_000_000n }, token: { coins: [], addressBalance: 7_000_000n } }),
  );
  assert.equal(
    base64.encode(usdc),
    'AAACAgDAz2oAAAAAAAAH26NGcuMMsGWx+T46tVMYdo/W/vZsFZQsn3y4RuL5AOcEdXNkYwRVU0RDAAAAIKcXWr3V7ZLr4605DbNmxqcGR4zfUXzebPmGMAZc2jd6AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgRjb2luDHJlZGVlbV9mdW5kcwEH26NGcuMMsGWx+T46tVMYdo/W/vZsFZQsn3y4RuL5AOcEdXNkYwRVU0RDAAEBAAABAQIAAAEBAFToDXbXkMJ39aRPPOkvU9JvWJSJK/OV3uY3WYiHa+ayAFToDXbXkMJ39aRPPOkvU9JvWJSJK/OV3uY3WYiHa+ayZAAAAAAAAABAS0wAAAAAAAIBCAUAAAAAAAABCQUAAAAAAAAAACA1g0qKwXykj7FKyPmcF8mHR+ld0HKUrkGkazgiRqRJmzkwAAA=',
  );
  assert.equal(
    signSuiTx(usdc, seed).signature,
    'AK5moGv2+NcANkUVDvQGsjNbUwYTP++hpPnJlnUgDhD7dfHkHOsv6SHj8Cwoh4ZbTJSQ8i8IYTISYaANmdQ7tQqF69FEH+T5VPvl3GB3vwCOEZpeJpKXxvcIPQAdKsh2/g==',
  );
});

/** A transaction that executed on Sui mainnet: its bytes, its signature, the digest the chain gave it. */
function assertLanded(bytes: Uint8Array, onChain: { tx: string; signature: string; digest: string; signer: string }) {
  assert.equal(base64.encode(bytes), onChain.tx);
  assert.equal(suiTxDigest(bytes), onChain.digest);
  const sig = base64.decode(onChain.signature);
  assert.equal(sig[0], 0x00);
  assert.equal(suiAddressOf(sig.subarray(65)), onChain.signer);
  assert.ok(ed25519.verify(sig.subarray(1, 65), suiSigningMessage(bytes), sig.subarray(65)));
}

const WALLET_A = '0x836df78a1ea9a9d9ca8f2ae92fc6799c72f63743d655bcfb5af90f70c599caab';
const WALLET_B = '0x87523b4864c9858aea9f6f7692ba81fb4d0692a0bf718c76869add391f69ecfa';
const SOURCE = '0x3b5bfe5427c241c78f45da9fef99a36a20f903658670b0eba424901ef76e1f8b';

test('the planner rebuilds transactions that executed on Sui mainnet, byte for byte', () => {
  // suiscan.xyz/mainnet/tx/Ffiza1ksFJ885TPZnjssvYdk6YgJivAy7TpzSgZVUJn2 — SUI from the address balance.
  assertLanded(
    suiTxBytes(plan({ sender: WALLET_A, to: WALLET_B, amount: 100_000_000n, budget: 2_091_000n, nonce: 274_159_711, sui: { coins: [], addressBalance: 500_000_000n } })),
    {
      tx: 'AAACAgAA4fUFAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIDc3VpA1NVSQAAACCHUjtIZMmFiuqfb3aSuoH7TQaSoL9xjHaGmt05H2ns+gIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIEY29pbgxyZWRlZW1fZnVuZHMBBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA3N1aQNTVUkAAQEAAAEBAgAAAQEAg233ih6pqdnKjyrpL8Z5nHL2N0PWVbz7WvkPcMWZyqsAg233ih6pqdnKjyrpL8Z5nHL2N0PWVbz7WvkPcMWZyqtkAAAAAAAAAPjnHwAAAAAAAgEIBQAAAAAAAAEJBQAAAAAAAAAAIDWDSorBfKSPsUrI+ZwXyYdH6V3QcpSuQaRrOCJGpEmbX1hXEA==',
      signature:
        'AMLBqbKol5X2jh0ZVUYiOGfZBYJPRVXLU/H3rOw50APXcFMJQemvvBS7nxqgEiW85ebdZWAq3PyEMRdthCtMZwTGMsvIec57ahzKczjOO6K/enVleZuBPnMuZ2oPr6gHNQ==',
      digest: 'Ffiza1ksFJ885TPZnjssvYdk6YgJivAy7TpzSgZVUJn2',
      signer: WALLET_A,
    },
  );
  // suiscan.xyz/mainnet/tx/363oW4VnTAsx1TdbRfi3xPBwWU5EieVoDDS7iZt6emAC — USDC from the address balance.
  assertLanded(
    suiTxBytes(
      plan({
        sender: WALLET_A,
        to: SOURCE,
        amount: 100_000n,
        coinType: USDC,
        nonce: 4_276_538_772,
        sui: { coins: [], addressBalance: 50_000_000n },
        token: { coins: [], addressBalance: 100_000n },
      }),
    ),
    {
      tx: 'AAACAgCghgEAAAAAAAAH26NGcuMMsGWx+T46tVMYdo/W/vZsFZQsn3y4RuL5AOcEdXNkYwRVU0RDAAAAIDtb/lQnwkHHj0Xan++Zo2og+QNlhnCw66QkkB73bh+LAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgRjb2luDHJlZGVlbV9mdW5kcwEH26NGcuMMsGWx+T46tVMYdo/W/vZsFZQsn3y4RuL5AOcEdXNkYwRVU0RDAAEBAAABAQIAAAEBAINt94oeqanZyo8q6S/GeZxy9jdD1lW8+1r5D3DFmcqrAINt94oeqanZyo8q6S/GeZxy9jdD1lW8+1r5D3DFmcqrZAAAAAAAAABAS0wAAAAAAAIBCAUAAAAAAAABCQUAAAAAAAAAACA1g0qKwXykj7FKyPmcF8mHR+ld0HKUrkGkazgiRqRJm5TN5v4=',
      signature:
        'ANxbQ1dQz8R4UP1CQ1XC27fZtOO/uPF6fZBkpiCpLIcDIxy5pGvOVtvyV4QJGy2qM8q/4wj8WKa+0p7wAdNJsQfGMsvIec57ahzKczjOO6K/enVleZuBPnMuZ2oPr6gHNQ==',
      digest: '363oW4VnTAsx1TdbRfi3xPBwWU5EieVoDDS7iZt6emAC',
      signer: WALLET_A,
    },
  );
  // suiscan.xyz/mainnet/tx/6qB8xFseugVfxPrTMAXoMxWG5Phearr4hZtEXZFSBJbU — a gas coin topped up from
  // the address balance (that one carried no ValidDuring; the wallet always writes it).
  const gasCoin: SuiCoin = {
    ref: { id: '0x039477668ecae25f3ec40f26a03ff9e8e9263adc5bf97e208a09f017cded3ada', version: 1_058_323_180n, digest: '71BhuNoCgNqNbThnHoEr4SaUSFZuvYkdsDGdXcmq4zVV' },
    balance: 55_000_000n, // 50 000 000 past the 5 000 000 budget: the other 100 000 000 is withdrawn
  };
  const topped = plan({ sender: WALLET_A, to: SOURCE, amount: 150_000_000n, sui: { coins: [gasCoin], addressBalance: 100_000_000n } });
  assertLanded(suiTxBytes({ ...topped, expiration: { none: true } }), {
    tx: 'AAADAgAA4fUFAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIDc3VpA1NVSQAAAAiA0fAIAAAAAAAgO1v+VCfCQcePRdqf75mjaiD5A2WGcLDrpCSQHvduH4sEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACBGNvaW4McmVkZWVtX2Z1bmRzAQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgNzdWkDU1VJAAEBAAADAAECAAACAAEBAQABAQMCAAAAAQIAg233ih6pqdnKjyrpL8Z5nHL2N0PWVbz7WvkPcMWZyqsBA5R3Zo7K4l8+xA8moD/56OkmOtxb+X4gignwF83tOtrsuhQ/AAAAACBZMjnawjkd4fRspwRimjCRr/8JYCiKOm0yNuhqYBZsMINt94oeqanZyo8q6S/GeZxy9jdD1lW8+1r5D3DFmcqrZAAAAAAAAABAS0wAAAAAAAA=',
    signature:
      'AINrrjFLufgc7SW5pkgRmzGuM8QSPbIT6tFyIsS8GnsMKCpImSIq6QiUazSguyiaIEgIiUYdRWSnR7vSgut4gQjGMsvIec57ahzKczjOO6K/enVleZuBPnMuZ2oPr6gHNQ==',
    digest: '6qB8xFseugVfxPrTMAXoMxWG5Phearr4hZtEXZFSBJbU',
    signer: WALLET_A,
  });
});

/* ------------------------------------ planning ------------------------------------ */

const coin = (n: number, balance: bigint): SuiCoin => ({
  ref: { id: `0x${n.toString(16).padStart(64, '0')}`, version: BigInt(n), digest: '71BhuNoCgNqNbThnHoEr4SaUSFZuvYkdsDGdXcmq4zVV' },
  balance,
});

test('SUI held in coins pays from the gas coin, bound to the network by ValidDuring', () => {
  const tx = plan({ amount: 1_000n, budget: 2_000_000n, sui: { coins: [coin(1, 5n), coin(2, 9_000_000n)], addressBalance: 0n } });
  assert.deepEqual(tx.gas.payment.map((r) => r.id), [coin(2, 0n).ref.id]); // the largest coin covers amount + budget
  assert.deepEqual(tx.commands, [{ split: { coin: { gas: true }, amounts: [{ input: 0 }] } }, { transfer: { objects: [{ nested: [0, 0] }], to: { input: 1 } } }]);
  assert.deepEqual(tx.expiration, { validDuring: { minEpoch: 1288n, maxEpoch: 1289n, chain: MAINNET, nonce: 12345 } });
});

test('a token held in several coins is merged, split and sent, gas from the SUI coins; an exact total is handed over whole', () => {
  const token = { coins: [coin(3, 400n), coin(4, 700n), coin(5, 50n)], addressBalance: 0n };
  const sui = { coins: [coin(6, 3_000_000n)], addressBalance: 0n };
  const tx = plan({ coinType: USDC, amount: 1_000n, budget: 2_000_000n, sui, token });
  assert.deepEqual(tx.gas.payment.map((r) => r.id), [coin(6, 0n).ref.id]);
  assert.deepEqual(tx.inputs.slice(0, 2), [{ owned: coin(4, 0n).ref }, { owned: coin(3, 0n).ref }]);
  assert.deepEqual(tx.commands, [
    { merge: { into: { input: 0 }, from: [{ input: 1 }] } },
    { split: { coin: { input: 0 }, amounts: [{ input: 2 }] } },
    { transfer: { objects: [{ nested: [1, 0] }], to: { input: 3 } } },
  ]);
  const whole = plan({ coinType: USDC, amount: 1_100n, budget: 2_000_000n, sui, token });
  assert.deepEqual(whole.commands, [{ merge: { into: { input: 0 }, from: [{ input: 1 }] } }, { transfer: { objects: [{ input: 0 }], to: { input: 2 } } }]);
});

test('what the coins lack comes from the address balance; what neither covers is no plan', () => {
  const token = { coins: [coin(3, 400n)], addressBalance: 600n };
  const tx = plan({ coinType: USDC, amount: 1_000n, budget: 2_000_000n, sui: { coins: [coin(6, 3_000_000n)], addressBalance: 0n }, token });
  assert.deepEqual(tx.inputs[1], { withdraw: { amount: 600n, coinType: USDC } });
  assert.equal(
    planSuiTransfer({ ...baseInput(), coinType: USDC, amount: 1_001n, sui: { coins: [coin(6, 3_000_000n)], addressBalance: 0n }, token }),
    null,
  );
  // SUI: the address balance pays the gas AND the withdrawal; together they must fit it.
  assert.equal(planSuiTransfer({ ...baseInput(), amount: 1_000n, sui: { coins: [], addressBalance: 2_000_999n } }), null);
  assert.ok(planSuiTransfer({ ...baseInput(), amount: 1_000n, sui: { coins: [], addressBalance: 2_001_000n } }));
});

function baseInput(): SuiPlanInput {
  return {
    sender: TW_SENDER,
    to: TW_RECIPIENT,
    amount: 1n,
    coinType: SUI_COIN_TYPE,
    sui: { coins: [], addressBalance: 0n },
    token: { coins: [], addressBalance: 0n },
    price: 100n,
    budget: 2_000_000n,
    epoch: 1288n,
    chain: MAINNET,
    nonce: 1,
  };
}

test('recipients: 0x and the full 64 hex digits, on Sui only', () => {
  assert.ok(isSuiAddress('sui', WALLET_A, 'mainnet'));
  assert.ok(isSuiAddress('sui', WALLET_A.toUpperCase().replace('0X', '0x'), 'testnet'));
  for (const bad of ['0x2', WALLET_A.slice(0, -1), WALLET_A.slice(2), `${WALLET_A}0`, 'alice.sui']) assert.ok(!isSuiAddress('sui', bad, 'mainnet'), bad);
  assert.ok(!isSuiAddress('aptos', WALLET_A, 'mainnet'));
});

/* ------------------------------------ sending ------------------------------------ */

const seed = () => Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const ownerOf = (s: Uint8Array) => suiAddressOf(ed25519.getPublicKey(s));

interface Service {
  chain?: string;
  suiCoins?: SuiCoin[];
  suiBalance?: bigint;
  tokCoins?: SuiCoin[];
  tokBalance?: bigint;
  gas?: { computationCost: number; storageCost: number; storageRebate: number };
  simulation?: { status: string; error?: string };
  execute?: (tx: string, sigs: string[]) => unknown;
}

const coinNodes = (coins: SuiCoin[]) => ({
  pageInfo: { hasNextPage: false, endCursor: null },
  nodes: coins.map((c) => ({ address: c.ref.id, version: Number(c.ref.version), digest: c.ref.digest, contents: { json: { id: c.ref.id, balance: String(c.balance) } } })),
});

/** Answer GraphQL by operation; record which ones were asked, and what was simulated. */
function service(s: Service = {}): { calls: string[]; simulated: string[] } {
  const calls: string[] = [];
  const simulated: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    let data: unknown;
    if (query.includes('chainIdentifier')) {
      calls.push('read');
      data = {
        chainIdentifier: s.chain ?? MAINNET,
        epoch: { epochId: 1295, referenceGasPrice: '100' },
        address: {
          sui: { addressBalance: String(s.suiBalance ?? 0n) },
          tok: { addressBalance: String(s.tokBalance ?? 0n) },
          suiCoins: coinNodes(s.suiCoins ?? []),
          tokCoins: coinNodes(s.tokCoins ?? []),
        },
      };
    } else if (query.includes('simulateTransaction')) {
      calls.push('simulate');
      simulated.push(String((variables.tx as { bcs: { value: string } }).bcs.value));
      const sim = s.simulation ?? { status: 'SUCCESS' };
      data = {
        simulateTransaction: {
          effects: {
            status: sim.status,
            executionError: sim.error ? { message: sim.error } : null,
            gasEffects: { gasSummary: s.gas ?? { computationCost: 100_000, storageCost: 1_976_000, storageRebate: 978_120 } },
          },
        },
      };
    } else if (query.includes('executeTransaction')) {
      calls.push('execute');
      const tx = String(variables.tx);
      data = s.execute ? s.execute(tx, variables.sigs as string[]) : { executeTransaction: { effects: { digest: suiTxDigest(base64.decode(tx)), status: 'SUCCESS', executionError: null } } };
    } else {
      throw new Error('unexpected query');
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
  return { calls, simulated };
}

function transfer(over: Partial<FamilyTransfer> = {}): FamilyTransfer {
  const secret = seed();
  const env = over.env ?? 'mainnet';
  return {
    network: 'sui',
    env,
    def: networkDefOn('sui', env)!,
    secret,
    owner: ownerOf(secret),
    asset: 'native',
    to: WALLET_B,
    amount: 1_000_000_000n,
    maxFee: 10_000_000n,
    ...over,
  };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

const executed = (calls: string[]) => calls.includes('execute');

test('a SUI send is simulated, budgeted as the SDK does, simulated again exactly as signed, and executed', async () => {
  let signedTx = '';
  let signature = '';
  const { calls, simulated } = service({
    suiCoins: [coin(1, 3_000_000_000n)],
    execute: (tx, sigs) => {
      signedTx = tx;
      signature = sigs[0];
      return { executeTransaction: { effects: { digest: suiTxDigest(base64.decode(tx)), status: 'SUCCESS' } } };
    },
  });
  const p = transfer();
  const digest = await sendSui(p);
  assert.deepEqual(calls, ['read', 'simulate', 'simulate', 'execute']);
  assert.equal(simulated[1], signedTx); // the bytes signed are the bytes last simulated
  const bytes = base64.decode(signedTx);
  assert.equal(digest, suiTxDigest(bytes));
  const sig = base64.decode(signature);
  assert.ok(ed25519.verify(sig.subarray(1, 65), suiSigningMessage(bytes), ed25519.getPublicKey(p.secret)));
  // budget = computation + 1 000 × price + storage − rebate = 100 000 + 100 000 + 997 880. It sits
  // before ValidDuring: tag, Some(u64), Some(u64), None, None, the 32-byte chain id, the u32 nonce.
  const validDuringLength = 1 + 9 + 9 + 1 + 1 + 33 + 4;
  const budget = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(bytes.length - validDuringLength - 8, true);
  assert.equal(budget, 1_197_880n);
});

test('a service of another network is refused before anything is simulated or signed', async () => {
  const { calls } = service({ chain: SUI_CHAIN_ID.testnet, suiCoins: [coin(1, 3_000_000_000n)] });
  assert.equal(await refusal(sendSui(transfer())), 'chain');
  assert.deepEqual(calls, ['read']);
  // and the test network's def against a mainnet service
  service({ chain: MAINNET, suiCoins: [coin(1, 3_000_000_000n)] });
  assert.equal(await refusal(sendSui(transfer({ env: 'testnet' }))), 'chain');
});

test('nothing held is unfunded; too little for the amount or for any budget is funds', async () => {
  const empty = service();
  assert.equal(await refusal(sendSui(transfer())), 'unfunded');
  assert.ok(!executed(empty.calls));
  const short = service({ suiCoins: [coin(1, 1_000_000_000n)] });
  assert.equal(await refusal(sendSui(transfer())), 'funds');
  assert.ok(!executed(short.calls));
  // USDC with no SUI to pay its gas
  const noGas = service({ tokCoins: [coin(2, 5_000_000n)] });
  assert.equal(await refusal(sendSui(transfer({ asset: USDC, amount: 1_000_000n }))), 'funds');
  assert.ok(!executed(noGas.calls));
});

test('a budget past maxFee — however the simulation inflates it — is refused, not signed', async () => {
  const inflated = service({ suiCoins: [coin(1, 30_000_000_000n)], gas: { computationCost: 50_000_000, storageCost: 0, storageRebate: 0 } });
  assert.equal(await refusal(sendSui(transfer())), 'fee');
  assert.ok(!executed(inflated.calls));
  // a cap below the protocol's least budget is refused before the node is asked to simulate
  const tiny = service({ suiCoins: [coin(1, 30_000_000_000n)] });
  assert.equal(await refusal(sendSui(transfer({ maxFee: 99_999n }))), 'fee');
  assert.deepEqual(tiny.calls, ['read']);
});

test('a simulation that fails is never signed: for want of funds it is funds, otherwise an error', async () => {
  const poor = service({ suiCoins: [coin(1, 3_000_000_000n)], simulation: { status: 'FAILURE', error: 'InsufficientCoinBalance in command 0' } });
  assert.equal(await refusal(sendSui(transfer())), 'funds');
  assert.ok(!executed(poor.calls));
  const broken = service({ suiCoins: [coin(1, 3_000_000_000n)], simulation: { status: 'FAILURE', error: 'MoveAbort in command 1' } });
  assert.match(String(await refusal(sendSui(transfer()))), /would fail/);
  assert.ok(!executed(broken.calls));
});

test('only the coin and the registry’s tokens, only to a full Sui address, only with our own key', async () => {
  const { calls } = service({ suiCoins: [coin(1, 3_000_000_000n)] });
  assert.equal(await refusal(sendSui(transfer({ asset: '0x2::other::OTHER' }))), 'address');
  assert.equal(await refusal(sendSui(transfer({ env: 'testnet', asset: USDC }))), 'address'); // test networks carry the coin only
  assert.equal(await refusal(sendSui(transfer({ to: '0x2' }))), 'address');
  assert.equal(await refusal(sendSui(transfer({ amount: 0n }))), 'minimum');
  assert.equal(await refusal(sendSui(transfer({ memo: 'deposit 42' }))), 'memo');
  assert.equal(await refusal(sendSui(transfer({ def: networkDefOn('near', 'mainnet')! }))), 'chain');
  assert.match(String(await refusal(sendSui(transfer({ owner: WALLET_A })))), /does not control/);
  assert.deepEqual(calls, []);
});

test('an execution answered for another transaction, or failed, is an error', async () => {
  service({ suiCoins: [coin(1, 3_000_000_000n)], execute: () => ({ executeTransaction: { effects: { digest: 'x', status: 'SUCCESS' } } }) });
  assert.match(String(await refusal(sendSui(transfer()))), /another transaction/);
  service({
    suiCoins: [coin(1, 3_000_000_000n)],
    execute: (tx) => ({ executeTransaction: { effects: { digest: suiTxDigest(base64.decode(tx)), status: 'FAILURE' } } }),
  });
  assert.match(String(await refusal(sendSui(transfer()))), /failed on chain/);
});
