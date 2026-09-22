import { gatewayApi } from "@/lib/endpoints";
import { newTraceId } from "@/lib/trace";

export interface DefindexFund {
  asset: string;
  total_amount: string;
}

export interface DefindexVault {
  address: string;
  totalManagedFunds: DefindexFund[];
  apy: number;
}

export interface DefindexDiscovery {
  totalVaults: number;
  vaults: DefindexVault[];
}

export interface DefindexBuildResult {
  xdr?: string;
  transactionXdr?: string;
  [key: string]: unknown;
}

async function request<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${gatewayApi()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Trace-Id": newTraceId(),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `DeFindex request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function discoverDefindex(apiKey: string): Promise<DefindexDiscovery> {
  return request(apiKey, "/v1/defindex/vaults");
}

export function defindexBalance(
  apiKey: string,
  vault: string,
  account: string,
): Promise<unknown> {
  return request(
    apiKey,
    `/v1/defindex/vaults/${encodeURIComponent(vault)}/balance?account=${encodeURIComponent(account)}`,
  );
}

export function buildDefindexDeposit(
  apiKey: string,
  vault: string,
  caller: string,
  amounts: string[],
): Promise<DefindexBuildResult> {
  return request(
    apiKey,
    `/v1/defindex/vaults/${encodeURIComponent(vault)}/deposit`,
    {
      method: "POST",
      body: JSON.stringify({ caller, amounts, invest: true, slippageBps: 100 }),
    },
  );
}

export function buildDefindexWithdraw(
  apiKey: string,
  vault: string,
  caller: string,
  shares: string,
): Promise<DefindexBuildResult> {
  return request(
    apiKey,
    `/v1/defindex/vaults/${encodeURIComponent(vault)}/withdraw`,
    {
      method: "POST",
      body: JSON.stringify({ caller, shares, slippageBps: 100 }),
    },
  );
}

export function submitDefindex(apiKey: string, xdr: string): Promise<unknown> {
  return request(apiKey, "/v1/defindex/submit", {
    method: "POST",
    body: JSON.stringify({ xdr }),
  });
}

export function defindexXdr(result: DefindexBuildResult): string {
  const value = result.xdr ?? result.transactionXdr;
  if (!value || typeof value !== "string")
    throw new Error("DeFindex did not return an unsigned transaction");
  return value;
}
