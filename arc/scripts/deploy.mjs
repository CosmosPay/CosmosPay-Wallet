/**
 * Deploys CosmosPayIntents to Arc.
 *
 *   npm install
 *   PRIVATE_KEY=0x... node scripts/deploy.mjs            # mainnet (chain 5042)
 *   PRIVATE_KEY=0x... NETWORK=testnet node scripts/deploy.mjs
 *
 * Gas on Arc is paid in USDC, so the deployer account needs a small USDC
 * balance. The native balance uses 18 decimals even though the ERC-20
 * interface uses 6: this script reads the native one, which is what pays gas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet, formatUnits } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const NETWORKS = {
  mainnet: { chainId: 5042, rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" },
  testnet: { chainId: 5042002, rpc: "https://rpc.testnet.arc.io", explorer: "https://explorer.testnet.arc.io" },
};

const network = NETWORKS[process.env.NETWORK ?? "mainnet"];
if (!network) throw new Error(`NETWORK must be mainnet or testnet`);

const key = process.env.PRIVATE_KEY;
if (!key) throw new Error("PRIVATE_KEY is required. Never commit it; pass it on the command line.");

function compile() {
  const name = "CosmosPayIntents.sol";
  const input = {
    language: "Solidity",
    sources: { [name]: { content: readFileSync(join(root, "contracts", name), "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const artifact = out.contracts[name].CosmosPayIntents;
  return { abi: artifact.abi, bytecode: "0x" + artifact.evm.bytecode.object };
}

const { abi, bytecode } = compile();
console.log(`compiled: ${(bytecode.length - 2) / 2} bytes`);

const provider = new JsonRpcProvider(network.rpc, network.chainId);
const wallet = new Wallet(key, provider);

const balance = await provider.getBalance(wallet.address);
console.log(`deployer: ${wallet.address}`);
console.log(`gas balance: ${formatUnits(balance, 18)} USDC`);
if (balance === 0n) throw new Error("The deployer has no USDC on Arc, so it cannot pay gas.");

const contract = await new ContractFactory(abi, bytecode, wallet).deploy();
console.log(`sent: ${contract.deploymentTransaction()?.hash}`);
await contract.waitForDeployment();

const address = await contract.getAddress();
console.log(`\ndeployed at ${address}`);
console.log(`${network.explorer}/address/${address}`);

writeFileSync(
  join(root, "deployment.json"),
  JSON.stringify({ network: process.env.NETWORK ?? "mainnet", chainId: network.chainId, address, abi }, null, 2) + "\n",
);
console.log("wrote deployment.json. Put the address into app/index.html");
