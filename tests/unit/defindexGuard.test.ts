import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { assertSafeDefindexTransaction } from "../../src/lib/defindexGuard.ts";
import type { NetConfig } from "../../src/lib/stellar.ts";

const network: NetConfig = {
  id: "testnet",
  label: "Testnet",
  horizon: "https://horizon-testnet.stellar.org",
  passphrase: Networks.TESTNET,
};

function contractId(): string {
  return StrKey.encodeContract(randomBytes(32));
}

function depositXdr(
  source: string,
  vault: string,
  amount = 10_000_000n,
): string {
  const operation = new Contract(vault).call(
    "deposit",
    nativeToScVal([amount]),
    nativeToScVal([amount - 100_000n]),
    nativeToScVal(source, { type: "address" }),
    nativeToScVal(true),
  );
  return new TransactionBuilder(new Account(source, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build()
    .toXDR();
}

test("accepts the exact DeFindex vault, caller and approved deposit amount", () => {
  const source = Keypair.random().publicKey();
  const vault = contractId();
  assert.doesNotThrow(() =>
    assertSafeDefindexTransaction(
      network,
      depositXdr(source, vault),
      source,
      vault,
      {
        kind: "deposit",
        amounts: ["10000000"],
        invest: true,
      },
    ),
  );
});

test("rejects a transaction redirected to another vault", () => {
  const source = Keypair.random().publicKey();
  const approvedVault = contractId();
  assert.throws(
    () =>
      assertSafeDefindexTransaction(
        network,
        depositXdr(source, contractId()),
        source,
        approvedVault,
        {
          kind: "deposit",
          amounts: ["10000000"],
          invest: true,
        },
      ),
    /contract does not match/,
  );
});

test("rejects a transaction whose deposit amount changed", () => {
  const source = Keypair.random().publicKey();
  const vault = contractId();
  assert.throws(
    () =>
      assertSafeDefindexTransaction(
        network,
        depositXdr(source, vault, 20_000_000n),
        source,
        vault,
        {
          kind: "deposit",
          amounts: ["10000000"],
          invest: true,
        },
      ),
    /amount 1 changed/,
  );
});
