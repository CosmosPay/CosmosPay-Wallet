/**
 * Paying XRP (src/lib/send/xrpl.ts). The serialization and the signature are pinned to published
 * vectors — XRPLF's ripple-binary-codec and ripple-keypairs fixtures, ripple-address-codec's
 * X-address cases — and to bytes the ledger's own nodes took: a blob xrplcluster.com decoded with
 * `simulate` and a payment the test network applied. Then, against a stubbed node, every refusal:
 * a node of the wrong network, a fee above the cap, an asset or recipient the screen did not
 * offer, a tag that is not one, a reserve the payment would break — and that none of those is
 * ever submitted.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { XRPL_MAINNET_LEDGER_FLOOR } from '@/constants/xrplSend';
import { networkAddressesFromMnemonic } from '@/lib/chainAddresses';
import { networkSecret } from '@/lib/chainKeys';
import {
  encodeXrplPayment,
  isXrplAddress,
  sendXrpl,
  signXrplPayment,
  xrplAccountId,
  xrplAddressOfKey,
  xrplTxId,
  xrplXAddress,
} from '@/lib/send/xrpl';
import type { FamilyTransfer } from '@/lib/send/types';
import { networkDefOn } from '@/lib/testnets';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const hex = (b: Uint8Array) => bytesToHex(b).toUpperCase();

/* ------------------------------ published vectors ----------------------------- */

test('a Payment serializes as ripple-binary-codec fixes it (codec-fixtures.json, the XRP Payment)', () => {
  // XRPLF/xrpl.js packages/ripple-binary-codec/test/fixtures/codec-fixtures.json
  const blob = encodeXrplPayment({
    account: xrplAccountId('r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV')!,
    destination: xrplAccountId('rLQBHVhFnaC5gLEkgr6HgBJJ3bgeZHg9cj')!,
    amount: 10_000_000_000n,
    fee: 10n,
    sequence: 62,
    flags: 0,
    signingPubKey: hexToBytes('034AADB09CFF4A4804073701EC53C3510CDC95917C2BB0150FB742D0C66E6CEE9E'),
    txnSignature: hexToBytes(
      '3045022022EB32AECEF7C644C891C19F87966DF9C62B1F34BABA6BE774325E4BB8E2DD62022100A51437898C28C2B297112DF8131F2BB39EA5FE613487DDD611525F1796264639',
    ),
  });
  assert.equal(
    hex(blob),
    '1200002200000000240000003E6140000002540BE40068400000000000000A7321034AADB09CFF4A4804073701EC53C3510CDC95917C2BB0150FB742D0C66E6CEE9E74473045022022EB32AECEF7C644C891C19F87966DF9C62B1F34BABA6BE774325E4BB8E2DD62022100A51437898C28C2B297112DF8131F2BB39EA5FE613487DDD611525F17962646398114550FC62003E785DC231A1058A05E56E3F09CF4E68314D4CC8AB5B21D86A82C3E9E8D0ECF2404B77FECBA',
  );
});

test('the secp256k1 key, address and signature match ripple-keypairs (test/fixtures/api.json)', () => {
  const secret = hexToBytes('D78B9735C3F26501C7337B8A5727FD53A6EFDBC6AA55984F098488561F985E23');
  const pub = secp256k1.getPublicKey(secret, true);
  assert.equal(hex(pub), '030D58EB48B4420B1F7B9DF55087E0E29FEF0E8468F9A6825B01CA2C361042D435');
  assert.equal(xrplAddressOfKey(pub), 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1');
  // ripple-keypairs signs SHA-512Half of the message, RFC 6979, low S, DER — what a payment's digest gets
  const digest = sha512(utf8ToBytes('test message')).subarray(0, 32);
  const sig = secp256k1.sign(digest, secret, { prehash: false, lowS: true, format: 'der' });
  assert.equal(
    hex(sig),
    '30440220583A91C95E54E6A651C47BEC22744E0B101E2C4060E7B08F6341657DAD9BC3EE02207D1489C7395DB0188D3A56A977ECBA54B36FA9371B40319655B1B4429E33EF2D',
  );
});

test('X-addresses decode as ripple-address-codec fixes them (test/index.test.ts)', () => {
  const classic = 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf';
  const cases: [number | null, string, string][] = [
    [null, 'XVLhHMPHU98es4dbozjVtdWzVrDjtV5fdx1mHp98tDMoQXb', 'TVE26TYGhfLC7tQDno7G8dGtxSkYQn49b3qD26PK7FcGSKE'],
    [0, 'XVLhHMPHU98es4dbozjVtdWzVrDjtV8AqEL4xcZj5whKbmc', 'TVE26TYGhfLC7tQDno7G8dGtxSkYQnSy8RHqGHoGJ59spi2'],
    [276, 'XVLhHMPHU98es4dbozjVtdWzVrDjtVoKj3MnFGMXEFMnvJV', 'TVE26TYGhfLC7tQDno7G8dGtxSkYQnTMgJJYfAbsiPsc6Zg'],
    [16781933, 'XVLhHMPHU98es4dbozjVtdWzVrDjtVqrDUk2vDpkTjPsY73', 'TVE26TYGhfLC7tQDno7G8dGtxSkYQnVsw45sDtGHhLi27Qa'],
    [4294967295, 'XVLhHMPHU98es4dbozjVtdWzVrDjtV18pX8yuPT7y4xaEHi', 'TVE26TYGhfLC7tQDno7G8dGtxSkYQnXoy6kSDh6rZzApc69'],
  ];
  for (const [tag, main, testnet] of cases) {
    for (const [address, env] of [[main, 'mainnet'], [testnet, 'testnet']] as const) {
      const x = xrplXAddress(address, env);
      assert.ok(x, address);
      assert.deepEqual([...x.accountId], [...xrplAccountId(classic)!]);
      assert.equal(x.tag, tag);
      assert.ok(isXrplAddress('xrp', address, env));
    }
    // an X-address names its network: the other mode's is not a recipient
    assert.equal(xrplXAddress(main, 'testnet'), null);
    assert.equal(xrplXAddress(testnet, 'mainnet'), null);
    assert.equal(isXrplAddress('xrp', main, 'testnet'), false);
  }
});

test('a classic address is checked to its checksum, and only on the XRP Ledger', () => {
  assert.ok(isXrplAddress('xrp', 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf', 'mainnet'));
  assert.ok(isXrplAddress('xrp', 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf', 'testnet'));
  assert.equal(isXrplAddress('xrp', 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpg', 'mainnet'), false); // last char changed
  assert.equal(isXrplAddress('xrp', 'rrGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf', 'mainnet'), false); // a leading zero byte more
  assert.equal(isXrplAddress('xrp', '0x000000000000000000000000000000000000dEaD', 'mainnet'), false);
  assert.equal(isXrplAddress('xrp', '', 'mainnet'), false);
  assert.equal(isXrplAddress('eth', 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf', 'mainnet'), false);
});

/* --------------------------- bytes the ledger took --------------------------- */

test('a blob with a destination tag and a last ledger is the one xrplcluster.com decoded (simulate, 2026-10-29)', () => {
  // Read-only `simulate` on the main network: the node echoed DestinationTag 4294967295,
  // LastLedgerSequence 107984555, Sequence 44196, Amount "1234567", Fee "12", and this hash
  // (with the empty TxnSignature simulate adds to an unsigned transaction).
  const tx = {
    account: xrplAccountId('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh')!,
    destination: xrplAccountId('rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf')!,
    amount: 1_234_567n,
    fee: 12n,
    sequence: 44196,
    flags: 0,
    lastLedgerSequence: 107984555,
    destinationTag: 4294967295,
    signingPubKey: new Uint8Array(0),
  };
  const blob = encodeXrplPayment(tx);
  assert.equal(
    hex(blob),
    '1200002200000000240000ACA42EFFFFFFFF201B066FB6AB61400000000012D68768400000000000000C73008114B5F762798A53D543A014CAF8B297CFF8F2F937E88314AA066C988C712815CC37AF71472B7CBBBD4E2A0A',
  );
  assert.equal(xrplTxId(encodeXrplPayment({ ...tx, txnSignature: new Uint8Array(0) })), '7178F04E61E4364E418D8610F659811E99BD42F8839B170B92718A4DBD69864F');
});

test('the payment the test network applied (tesSUCCESS, 2026-10-29) is re-signed byte for byte', async () => {
  // The debug wallet (SEP-5's public phrase) paid 0.1 XRP with tag 12345 on the XRPL test
  // network: 7CC31FA4… validated in ledger 21918423. RFC 6979 makes the signature deterministic.
  const owner = 'rHfsP8wmWDEvSvBZu4VsF9BUB6wqXDo4xU';
  assert.equal((await networkAddressesFromMnemonic(DEBUG_WALLET_PHRASE)).xrp, owner);
  const secret = await networkSecret(DEBUG_WALLET_PHRASE, 'xrp', owner, 'testnet');
  try {
    const signingPubKey = secp256k1.getPublicKey(secret, true);
    const { blob, hash } = signXrplPayment(
      {
        account: xrplAccountId(owner)!,
        destination: xrplAccountId('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')!,
        amount: 100_000n,
        fee: 10n,
        sequence: 19825410,
        flags: 0,
        lastLedgerSequence: 21918441,
        destinationTag: 12345,
        signingPubKey,
      },
      secret,
    );
    assert.equal(
      hex(blob),
      '120000220000000024012E83022E00003039201B014E72E96140000000000186A068400000000000000A732103F3930109E6D71B80AB7D6840080DDC2C91AD328D99E264A10DC8E95E150D0B507446304402206FB6E8A95E5B144DA99D6389D6D8FF93CA9D017A42C103342D9C265C12D18E1402203841DBB2868D98F2B6A739FEA5D10A2995F2A39535C561A73DF522BBEF7B34758114B0A6817370915E1865E8B75003515836B91B30838314F667B0CA50CC7709A220B0561B85E53A48461FA8',
    );
    assert.equal(hash, '7CC31FA4272ABC19B4DDAC12DB33D817D632ED1D759C22373D944F1279B52EDA');
  } finally {
    secret.fill(0);
  }
});

/* -------------------------------- stubbed node ------------------------------- */

const secret = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OWNER = xrplAddressOfKey(secp256k1.getPublicKey(secret(), true));
const DEST = 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf';
const MAIN_LEDGER = XRPL_MAINNET_LEDGER_FLOOR + 1000;
const TEST_LEDGER = 21_918_000;

interface Account {
  Balance: string;
  Sequence: number;
  OwnerCount: number;
  Flags: number;
}

interface NodeState {
  networkId?: number;
  ledger?: number;
  openFee?: string;
  accounts?: Record<string, Account | null>;
  depositAuthorized?: boolean;
  engine?: string;
}

/** A rippled answering by method; records the methods called and the blob submitted. */
function node(s: NodeState = {}): { called: string[]; blobs: string[] } {
  const called: string[] = [];
  const blobs: string[] = [];
  const accounts: Record<string, Account | null> = {
    [OWNER]: { Balance: '50000000', Sequence: 7, OwnerCount: 0, Flags: 0 },
    [DEST]: { Balance: '20000000', Sequence: 3, OwnerCount: 0, Flags: 0 },
    ...s.accounts,
  };
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: Record<string, unknown>[] };
    called.push(method);
    const p = params[0];
    let result: Record<string, unknown>;
    if (method === 'server_state') {
      result = {
        status: 'success',
        state: {
          network_id: s.networkId ?? 0,
          validated_ledger: { seq: s.ledger ?? MAIN_LEDGER, base_fee: 10, reserve_base: 1_000_000, reserve_inc: 200_000 },
        },
      };
    } else if (method === 'account_info') {
      const a = accounts[String(p.account)];
      result = a ? { status: 'success', account_data: { Account: p.account, ...a } } : { status: 'error', error: 'actNotFound' };
    } else if (method === 'fee') {
      result = { status: 'success', drops: { base_fee: '10', minimum_fee: '10', median_fee: '5000', open_ledger_fee: s.openFee ?? '12' } };
    } else if (method === 'deposit_authorized') {
      result = { status: 'success', deposit_authorized: s.depositAuthorized ?? false };
    } else if (method === 'submit') {
      blobs.push(String(p.tx_blob));
      result = { status: 'success', engine_result: s.engine ?? 'tesSUCCESS' };
    } else {
      throw new Error(`unexpected ${method}`);
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  return { called, blobs };
}

const transfer = (over: Partial<FamilyTransfer> = {}): FamilyTransfer => ({
  network: 'xrp',
  env: 'mainnet',
  def: networkDefOn('xrp', over.env ?? 'mainnet')!,
  secret: secret(),
  owner: OWNER,
  asset: 'native',
  to: DEST,
  amount: 2_000_000n,
  maxFee: 100_000n,
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

test('a payment is signed with the open-ledger fee, a 20-ledger window and the tag, then submitted', async () => {
  const { called, blobs } = node({ openFee: '15' });
  const id = await sendXrpl(transfer({ memo: ' 77 ' }));
  assert.match(id, /^[0-9A-F]{64}$/);
  assert.equal(blobs.length, 1);
  assert.equal(xrplTxId(hexToBytes(blobs[0])), id);
  const signed = blobs[0];
  assert.ok(signed.startsWith('12000022000000002400000007' + '2E0000004D' + `201B${(MAIN_LEDGER + 20).toString(16).toUpperCase().padStart(8, '0')}`));
  assert.ok(signed.includes('68400000000000000F')); // Fee 15 drops
  assert.deepEqual(called.filter((m) => m === 'submit'), ['submit']);
});

test('an X-address pays its account with its own tag; the same tag typed beside it is fine', async () => {
  const x = 'XVLhHMPHU98es4dbozjVtdWzVrDjtVoKj3MnFGMXEFMnvJV'; // rGWrZ…, tag 276
  const { blobs } = node();
  await sendXrpl(transfer({ to: x, memo: '276' }));
  assert.ok(blobs[0].includes('2E00000114'));
});

test('a node of another network is refused before anything is signed', async () => {
  // a test-network node answering in main mode
  const test = node({ networkId: 1, ledger: TEST_LEDGER });
  assert.equal(await refusal(sendXrpl(transfer())), 'chain');
  assert.deepEqual(test.called, ['server_state']);
  // network id 0 with a ledger below the main network's floor: not the main network
  const behind = node({ networkId: 0, ledger: TEST_LEDGER });
  assert.equal(await refusal(sendXrpl(transfer())), 'chain');
  assert.ok(!behind.called.includes('submit'));
  // a node without a network id says nothing it can be held to
  const silent = node({ networkId: -1 });
  assert.equal(await refusal(sendXrpl(transfer())), 'chain');
  assert.ok(!silent.called.includes('submit'));
});

test('in test mode the node must be the test network, below the main ledger floor', async () => {
  const ok = node({ networkId: 1, ledger: TEST_LEDGER });
  assert.match(await sendXrpl(transfer({ env: 'testnet' })), /^[0-9A-F]{64}$/);
  assert.ok(ok.called.includes('submit'));
  // the main network answering in test mode
  const main = node();
  assert.equal(await refusal(sendXrpl(transfer({ env: 'testnet' }))), 'chain');
  assert.ok(!main.called.includes('submit'));
  // a "test" ledger so close to the floor that the payment could still be live on the main network
  const close = node({ networkId: 1, ledger: XRPL_MAINNET_LEDGER_FLOOR - 5 });
  assert.equal(await refusal(sendXrpl(transfer({ env: 'testnet' }))), 'chain');
  assert.ok(!close.called.includes('submit'));
});

test('an open-ledger fee above the cap is refused, not paid', async () => {
  const { called } = node({ openFee: '100001' });
  assert.equal(await refusal(sendXrpl(transfer())), 'fee');
  assert.ok(!called.includes('submit'));
});

test('only XRP itself, to a recipient that is an address of the mode and not ourselves', async () => {
  const { called } = node();
  assert.equal(await refusal(sendXrpl(transfer({ asset: 'USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq' }))), 'address');
  assert.equal(await refusal(sendXrpl(transfer({ to: 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpg' }))), 'address');
  assert.equal(await refusal(sendXrpl(transfer({ to: 'TVE26TYGhfLC7tQDno7G8dGtxSkYQnTMgJJYfAbsiPsc6Zg' }))), 'address');
  assert.equal(await refusal(sendXrpl(transfer({ to: OWNER }))), 'address');
  assert.deepEqual(called, []);
});

test('a tag that is not a uint32, or one that disagrees with the X-address, is refused', async () => {
  const { called } = node();
  for (const memo of ['abc', '-1', '1.5', '4294967296', '12345678901', '0x10']) {
    assert.equal(await refusal(sendXrpl(transfer({ memo }))), 'memo', memo);
  }
  assert.equal(await refusal(sendXrpl(transfer({ to: 'XVLhHMPHU98es4dbozjVtdWzVrDjtVoKj3MnFGMXEFMnvJV', memo: '277' }))), 'memo');
  assert.deepEqual(called, []);
});

test('a recipient that requires a destination tag gets one or nothing is sent', async () => {
  const { called } = node({ accounts: { [DEST]: { Balance: '20000000', Sequence: 3, OwnerCount: 0, Flags: 0x0002_0000 } } });
  assert.equal(await refusal(sendXrpl(transfer())), 'memo');
  assert.ok(!called.includes('submit'));
  const tagged = node({ accounts: { [DEST]: { Balance: '20000000', Sequence: 3, OwnerCount: 0, Flags: 0x0002_0000 } } });
  await sendXrpl(transfer({ memo: '9' }));
  assert.ok(tagged.called.includes('submit'));
});

test('the sender keeps its reserve, the base plus one increment per owned object', async () => {
  // 50 XRP, 2 owned objects: reserve 1.4 XRP; 48.6 XRP minus the fee breaks it
  const accounts = { [OWNER]: { Balance: '50000000', Sequence: 7, OwnerCount: 2, Flags: 0 } };
  const over = node({ accounts });
  assert.equal(await refusal(sendXrpl(transfer({ amount: 48_600_000n }))), 'funds');
  assert.ok(!over.called.includes('submit'));
  const fits = node({ accounts });
  await sendXrpl(transfer({ amount: 48_600_000n - 12n }));
  assert.ok(fits.called.includes('submit'));
});

test('a payment that creates the recipient carries at least the base reserve', async () => {
  const fresh = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';
  const below = node({ accounts: { [fresh]: null } });
  assert.equal(await refusal(sendXrpl(transfer({ to: fresh, amount: 999_999n }))), 'minimum');
  assert.ok(!below.called.includes('submit'));
  const enough = node({ accounts: { [fresh]: null } });
  await sendXrpl(transfer({ to: fresh, amount: 1_000_000n }));
  assert.ok(enough.called.includes('submit'));
});

test('an account nobody funded yet cannot pay', async () => {
  const { called } = node({ accounts: { [OWNER]: null } });
  assert.equal(await refusal(sendXrpl(transfer())), 'unfunded');
  assert.ok(!called.includes('submit'));
});

test('a deposit-authorising recipient that has not authorised us is refused', async () => {
  const accounts = { [DEST]: { Balance: '20000000', Sequence: 3, OwnerCount: 0, Flags: 0x0100_0000 } };
  const no = node({ accounts, depositAuthorized: false });
  assert.equal(await refusal(sendXrpl(transfer())), 'address');
  assert.ok(!no.called.includes('submit'));
  const yes = node({ accounts, depositAuthorized: true });
  await sendXrpl(transfer());
  assert.ok(yes.called.includes('submit'));
});

test('a submit the ledger rejects is an error naming its engine result; a queued one is accepted', async () => {
  node({ engine: 'tecUNFUNDED_PAYMENT' });
  assert.match(String(await refusal(sendXrpl(transfer()))), /tecUNFUNDED_PAYMENT/);
  node({ engine: 'terQUEUED' });
  assert.match(await sendXrpl(transfer()), /^[0-9A-F]{64}$/);
});

test('a key that does not control the owner never signs', async () => {
  const { called } = node();
  assert.match(String(await refusal(sendXrpl(transfer({ owner: DEST })))), /does not control/);
  assert.ok(!called.includes('submit'));
});
