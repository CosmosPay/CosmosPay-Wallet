# Cosmos Pay on Arc

A payment intent is the object Cosmos Pay already uses on Stellar: who charges, how much, what for, and whether it was paid. This is that same object on [Arc](https://docs.arc.io), Circle's L1 where gas is paid in USDC.

A merchant opens an intent, a customer settles it in USDC, and the receipt is an event anyone can read on-chain. The contract never holds funds: `pay` moves USDC straight from the payer to the merchant.

## Why this is here

Cosmos Pay is a wallet for Latin America. Money comes in as local currency, is held as USDC, and goes out in local currency through anchors. The rail underneath is a detail the user should never have to think about, which is exactly why it should not be a single rail.

Arc is the second one. Charging on Arc costs a fraction of a cent, settles in under a second, and the gas is the same dollar the merchant is being paid in, so a merchant never has to hold a separate gas token to get paid. For a corner shop in Salta that difference is the whole product.

## What is in here

| Path | What it is |
|---|---|
| `contracts/CosmosPayIntents.sol` | The contract: `create`, `pay`, `get`, `canPay`, two events |
| `scripts/deploy.mjs` | Compiles and deploys to Arc mainnet or testnet |
| `app/index.html` | The mini app: connect, charge, share a link, pay, see the receipt |

## Run it

```bash
cd arc
npm install

# Deploy. Gas is USDC, so the deployer needs a small USDC balance on Arc.
PRIVATE_KEY=0x… npm run deploy            # mainnet, chain 5042
PRIVATE_KEY=0x… npm run deploy:testnet    # testnet, chain 5042002

# Put the printed address into DEPLOYED in app/index.html, then:
npm run serve                             # http://localhost:4173
```

The app also takes the address from the query string, so `?c=0x…` works without editing the file. A payment link carries both: `?c=0x…&id=0x…`.

## Network details

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 5042 | 5042002 |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` | same |

Gas is USDC with 18 decimals natively, while the ERC-20 interface uses 6. The contract works in the ERC-20 units; only the gas balance is the 18-decimal one. Testnet funds come from [faucet.circle.com](https://faucet.circle.com).

## How it maps to what Cosmos Pay already does

| Cosmos Pay on Stellar | Here on Arc |
|---|---|
| SEP-7 payment intent (`web+stellar:pay?…`) | `create(id, amount, memo)` and a link carrying the id |
| The payer's wallet signs and submits | `approve` then `pay`, from any EVM wallet |
| `intent.validate(txHash)` confirms settlement | `get(id)` returns `paid`, and `IntentPaid` is the receipt |

## Status

The contract compiles with solc 0.8.37, optimizer on, at about 2.1 KB of bytecode. Deployment addresses are recorded in `deployment.json` once you run the deploy script.
