# Cosmos Pay on Arc

Charge in USDC on [Arc](https://docs.arc.io) and settle to the merchant in one transaction. The receipt is an event anyone can read on-chain.

A payment intent is the object Cosmos Pay already uses on Stellar: who charges, how much, what for, and whether it was paid. This is that same object on Arc, Circle's L1 where gas is paid in USDC.

```
merchant: create(id, amount, memo)  ->  link + QR  ->  payer: approve + pay  ->  IntentPaid
```

The contract never holds funds. `pay` moves USDC straight from the payer to the merchant and writes the receipt, so there is no balance sitting in an escrow nobody audits, and no owner who could freeze one.

## Why Arc

Cosmos Pay is a wallet for Latin America: local currency comes in as a bank transfer, value is held as USDC, and it goes back out in local currency through anchors. The rail underneath should be a detail the user never thinks about, which is exactly why it should not be a single rail.

Arc is the second one, and it fits the merchant case better than anything we have used:

- **Gas is USDC.** A corner shop in Salta never has to buy a second token before it can get paid. That one fact removes the step where most merchants give up.
- **Settlement is sub-second and costs a fraction of a cent**, so charging 2 USDC is not absurd.
- **CCTP is native**, so USDC that arrives on another chain can reach the same merchant without a custom bridge.

## What is here

| Path | What it is |
|---|---|
| `contracts/CosmosPayIntents.sol` | The contract: `create`, `pay`, `get`, `canPay`, two events. 2,089 bytes, no dependencies, no owner |
| `test/CosmosPayIntents.t.sol` | 12 tests, including a fuzz run and a token that fails without reverting |
| `scripts/deploy.mjs` | Compiles and deploys to Arc mainnet or testnet |
| `app/index.html` | The mini app: charge, share a link with a QR, pay, read the receipt |

## Run it

```bash
cd arc
forge install foundry-rs/forge-std --no-git   # once
forge test -vv                                # 12 passing
forge build --sizes

npm install
PRIVATE_KEY=0x… npm run deploy                # mainnet, chain 5042
PRIVATE_KEY=0x… npm run deploy:testnet        # testnet, chain 5042002

# Put the printed address into DEPLOYED in app/index.html, then:
npm run serve                                 # http://localhost:4173
```

Gas is USDC, so the deployer needs a small USDC balance on Arc. Testnet funds come from [faucet.circle.com](https://faucet.circle.com).

The app also reads the address from the query string, so `?c=0x…` works without editing the file, and a payment link carries both the contract and the intent: `?c=0x…&id=0x…`.

## Network details

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 5042 | 5042002 |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| USDC, ERC-20 interface | `0x3600000000000000000000000000000000000000` | same |

Gas is USDC with 18 decimals natively, while the ERC-20 interface uses 6. The contract works in ERC-20 units; only the gas balance is the 18-decimal one. Mixing them is the first mistake everyone makes on Arc, so the tests pin the units.

## Design notes

- **`uint96` for the amount.** USDC has 6 decimals, so this holds about 79 trillion dollars and lets an intent fit in two storage slots instead of three. Creating a charge is cheaper because of it.
- **The id is chosen by the caller.** A wallet derives it from its own payment reference, so it can render the link before the transaction confirms rather than waiting to learn an id from a receipt.
- **The memo lives in the log, not in storage.** Nobody reads it on-chain, and storing it would cost the merchant money on every charge.
- **`canPay` exists so the page can explain itself.** It reports balance and allowance separately, so the app says what is missing instead of sending a transaction that reverts.
- **A transfer that returns `false` reverts the whole call.** Some tokens report failure instead of reverting; the intent must not end up marked as paid when no money moved. There is a test for exactly that.

## How it maps to Cosmos Pay on Stellar

| On Stellar | Here on Arc |
|---|---|
| SEP-7 payment intent (`web+stellar:pay?…`) | `create(id, amount, memo)` plus a link that carries the id |
| The payer's wallet signs and submits | `approve` then `pay`, from any EVM wallet |
| `intent.validate(txHash)` confirms settlement | `get(id)` returns `paid`, and `IntentPaid` is the receipt |
| Anchors move the money in and out in local currency | CCTP brings USDC in from 20+ chains |

## Status

Contract tests pass on every push through [`.github/workflows/arc.yml`](../.github/workflows/arc.yml): build, test and format check. Deployment addresses land in `deployment.json` once the deploy script runs.
