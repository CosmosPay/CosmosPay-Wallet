/**
 * Bitcoin spends (`lib/bitcoinTx.ts`): which outputs, what fee, and a transaction that is
 * really ours — signed by the key behind the address on screen, paying exactly the amount
 * typed, with change back to ourselves. Nothing here touches a node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { chainAddressesFromMnemonic } from '@/lib/chainAddresses';
import { chainSecret } from '@/lib/chainKeys';
import {
  BitcoinSpendRefused,
  bitcoinOutputScript,
  isBitcoinAddress,
  maxSendable,
  planSpend,
  signBitcoinPayment,
  spendVsize,
} from '@/lib/bitcoinTx';
import { isChainAddress } from '@/lib/chainSwap';
import { BITCOIN_DUST_SATS, BITCOIN_MAX_FEE_RATE } from '@/constants/chains';
import type { BitcoinUtxo } from '@/lib/chainRpc';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TXID = (n: number) => n.toString(16).padStart(64, '0');
const utxo = (n: number, value: bigint, confirmed = true): BitcoinUtxo => ({ txid: TXID(n), vout: 0, value, confirmed });

test('addresses are checked with their checksum and for the network they are paid on', () => {
  assert.ok(isBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'));
  assert.ok(isBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')); // P2PKH
  assert.ok(isBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')); // P2SH
  assert.ok(isBitcoinAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')); // taproot
  assert.ok(!isBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv'), 'one character off is not an address');
  assert.ok(!isBitcoinAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl'), 'a testnet address on mainnet');
  assert.ok(isBitcoinAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', 'testnet'));
  assert.ok(!isBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'testnet'), 'a mainnet address on testnet');
  assert.ok(!isChainAddress('bitcoin', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
  assert.equal(bitcoinOutputScript('nonsense', 'mainnet'), null);
});

test('vsize follows the BIP-141 weights of a P2WPKH spend', () => {
  // 1 input, 2 P2WPKH outputs: the textbook 141 vB.
  assert.equal(spendVsize(1, [22, 22]), 141);
  assert.equal(spendVsize(2, [22, 22]), 209);
});

test('confirmed, larger outputs are spent first, and change below dust goes to the fee', () => {
  const plan = planSpend([utxo(1, 5_000n, false), utxo(2, 100_000n), utxo(3, 20_000n)], 50_000n, 2, 22);
  assert.deepEqual(plan.inputs.map((u) => u.txid), [TXID(2)]);
  assert.equal(plan.fee, BigInt(spendVsize(1, [22, 22]) * 2));
  assert.equal(plan.change, 100_000n - 50_000n - plan.fee);

  const tight = planSpend([utxo(1, 50_400n)], 50_000n, 1, 22);
  assert.equal(tight.change, 0n);
  assert.equal(tight.fee, 400n, 'the would-be change is below dust and becomes fee');
});

test('a spend it cannot cover, a dust amount or an absurd fee rate is refused', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as BitcoinSpendRefused).code;
    }
    return null;
  };
  assert.equal(code(() => planSpend([utxo(1, 10_000n)], 9_990n, 5, 22)), 'funds');
  assert.equal(code(() => planSpend([utxo(1, 10_000n)], BITCOIN_DUST_SATS, 1, 22)), 'dust');
  assert.equal(code(() => planSpend([utxo(1, 10_000_000n)], 10_000n, BITCOIN_MAX_FEE_RATE + 1, 22)), 'fee');
});

test('max sendable leaves exactly the fee of a no-change spend of everything', () => {
  const utxos = [utxo(1, 30_000n), utxo(2, 20_000n)];
  assert.equal(maxSendable(utxos, 3), 50_000n - BigInt(spendVsize(2, [22]) * 3));
  assert.equal(maxSendable([utxo(1, 100n)], 10), 0n);
});

test('the signed payment is ours: our key, the amount typed, change back to us', async () => {
  const { bitcoin } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'bitcoin', bitcoin, 'mainnet');
  const to = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
  const signed = signBitcoinPayment({
    utxos: [utxo(7, 250_000n)],
    secret,
    owner: bitcoin,
    to,
    amount: 100_000n,
    feeRate: 4,
    net: 'mainnet',
  });
  const tx = Transaction.fromRaw(Buffer.from(signed.hex, 'hex'));
  assert.equal(tx.id, signed.txid);
  assert.equal(tx.inputsLength, 1);
  assert.equal(tx.outputsLength, 2);
  assert.deepEqual(tx.getOutput(0).script, bitcoinOutputScript(to, 'mainnet'));
  assert.equal(tx.getOutput(0).amount, 100_000n);
  const ours = p2wpkh(secp256k1.getPublicKey(secret, true), NETWORK).script;
  assert.deepEqual(tx.getOutput(1).script, ours);
  assert.equal(tx.getOutput(1).amount, 250_000n - 100_000n - signed.plan.fee);
  // A witness signature is present on the one input.
  assert.ok((tx.getInput(0).finalScriptWitness?.length ?? 0) === 2);
});

test('a key that is not the one behind the address shown does not sign', async () => {
  const { bitcoinTestnet } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'bitcoin', bitcoinTestnet, 'testnet');
  assert.throws(
    () =>
      signBitcoinPayment({
        utxos: [utxo(1, 50_000n)],
        secret,
        owner: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        to: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
        amount: 10_000n,
        feeRate: 1,
        net: 'mainnet',
      }),
    (e) => e instanceof BitcoinSpendRefused && e.code === 'address',
  );
});
