import {
  Address,
  FeeBumpTransaction,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { NetConfig } from "@/lib/stellar";

const MAX_FEE_STROOPS = 10_000_000n;
const MAX_VALIDITY_SECONDS = 15 * 60;

export type DefindexIntent =
  | { kind: "deposit"; amounts: string[]; invest: boolean }
  | { kind: "withdraw"; shares: string };

function fail(message: string): never {
  throw new Error(`Unsafe DeFindex transaction: ${message}`);
}

function asBigInt(value: unknown, label: string): bigint {
  if (
    typeof value !== "bigint" &&
    typeof value !== "number" &&
    typeof value !== "string"
  )
    fail(`${label} is unreadable`);
  try {
    return BigInt(value as bigint | number | string);
  } catch {
    return fail(`${label} is unreadable`);
  }
}

export function assertSafeDefindexTransaction(
  cfg: NetConfig,
  envelope: string,
  signer: string,
  vault: string,
  intent: DefindexIntent,
): void {
  const parsed = TransactionBuilder.fromXDR(envelope, cfg.passphrase);
  if (parsed instanceof FeeBumpTransaction)
    fail("fee-bump envelopes are not accepted");
  if (parsed.source !== signer)
    fail("the source account does not match this wallet");
  if (BigInt(parsed.fee) > MAX_FEE_STROOPS)
    fail("the fee exceeds the wallet limit");
  if (parsed.operations.length !== 1)
    fail("exactly one contract call is required");

  const bounds = parsed.timeBounds;
  const now = Math.floor(Date.now() / 1000);
  const maxTime = bounds?.maxTime ? Number(bounds.maxTime) : 0;
  if (!maxTime || maxTime < now - 60 || maxTime > now + MAX_VALIDITY_SECONDS)
    fail("the validity window is missing or too long");

  const operation = parsed.operations[0] as unknown as {
    type?: string;
    source?: string;
    func?: {
      invokeContract?: () => {
        contractAddress: () => unknown;
        functionName: () => unknown;
        args: () => unknown[];
      };
    };
  };
  if (operation.type !== "invokeHostFunction" || operation.source)
    fail("unexpected operation or operation source");
  const call = operation.func?.invokeContract?.();
  if (!call) fail("the host function is not a contract invocation");
  const contract = Address.fromScAddress(
    call.contractAddress() as Parameters<typeof Address.fromScAddress>[0],
  ).toString();
  if (contract !== vault)
    fail("the contract does not match the selected vault");
  const functionName = String(call.functionName());
  const args = call
    .args()
    .map((arg) => scValToNative(arg as Parameters<typeof scValToNative>[0]));

  if (intent.kind === "deposit") {
    if (functionName !== "deposit" || args.length !== 4)
      fail("unexpected deposit function signature");
    if (!Array.isArray(args[0]) || !Array.isArray(args[1]))
      fail("deposit amounts are unreadable");
    const desired = args[0].map((value: unknown, index: number) =>
      asBigInt(value, `amount ${index + 1}`),
    );
    const minimum = args[1].map((value: unknown, index: number) =>
      asBigInt(value, `minimum ${index + 1}`),
    );
    const approved = intent.amounts.map(BigInt);
    if (
      desired.length !== approved.length ||
      minimum.length !== approved.length
    )
      fail("the asset count changed");
    desired.forEach((value: bigint, index: number) => {
      if (
        value !== approved[index] ||
        minimum[index] < 0n ||
        minimum[index] > value
      )
        fail(`amount ${index + 1} changed`);
    });
    if (args[2] !== signer || args[3] !== intent.invest)
      fail("the caller or invest option changed");
    return;
  }

  if (functionName !== "withdraw" || args.length !== 3)
    fail("unexpected withdraw function signature");
  if (asBigInt(args[0], "shares") !== BigInt(intent.shares))
    fail("the share amount changed");
  if (
    !Array.isArray(args[1]) ||
    args[1].some((value: unknown) => asBigInt(value, "minimum output") < 0n)
  )
    fail("minimum outputs are unreadable");
  if (args[2] !== signer) fail("the caller changed");
}
