import { NextRequest, NextResponse } from "next/server";

const SOROBAN_RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ||
  "https://soroban-rpc.mainnet.stellar.gateway.fm";

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon.stellar.org";

let jsonRpcId = 1;

async function sorobanRpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: jsonRpcId++,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`Soroban RPC HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(
      `Soroban RPC error ${json.error.code}: ${json.error.message ?? JSON.stringify(json.error)}`,
    );
  }
  return json.result;
}

/**
 * Check Horizon for a transaction by hash.
 * Returns "SUCCESS", "FAILED", or "NOT_FOUND".
 */
async function checkHorizon(hash: string): Promise<string> {
  try {
    const res = await fetch(`${HORIZON_URL}/transactions/${hash}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return "NOT_FOUND";
    if (!res.ok) return "NOT_FOUND";
    const data = await res.json();
    if (data?.successful === true) return "SUCCESS";
    if (data?.successful === false) return "FAILED";
    // If the tx exists on Horizon at all, it was included in a ledger
    return data?.hash ? "SUCCESS" : "NOT_FOUND";
  } catch {
    return "NOT_FOUND";
  }
}

/**
 * Lightweight endpoint to check Stellar transaction confirmation status.
 * Checks both Soroban RPC and Horizon for redundancy.
 * Returns: { status: "SUCCESS" | "FAILED" | "NOT_FOUND", hash, source }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!hash) {
    return NextResponse.json(
      { error: "Transaction hash required" },
      { status: 400 },
    );
  }

  try {
    // Try Soroban RPC first (faster for Soroban txs)
    const txResult = await sorobanRpc("getTransaction", { hash });
    const rpcStatus = txResult?.status || "NOT_FOUND";

    if (rpcStatus === "SUCCESS" || rpcStatus === "FAILED") {
      return NextResponse.json({
        hash,
        status: rpcStatus,
        source: "soroban-rpc",
      });
    }

    // If Soroban RPC says NOT_FOUND, try Horizon as fallback
    // (Horizon indexes all transactions, sometimes sooner for classic-wrapped Soroban ops)
    const horizonStatus = await checkHorizon(hash);
    if (horizonStatus !== "NOT_FOUND") {
            return NextResponse.json({
        hash,
        status: horizonStatus,
        source: "horizon",
      });
    }

    return NextResponse.json({ hash, status: "NOT_FOUND", source: "both" });
  } catch (error: any) {
    // Even if Soroban RPC errored, try Horizon
        const horizonStatus = await checkHorizon(hash);
    if (horizonStatus !== "NOT_FOUND") {
      return NextResponse.json({
        hash,
        status: horizonStatus,
        source: "horizon-fallback",
      });
    }

    return NextResponse.json(
      { error: error.message || "Failed to check transaction status" },
      { status: 500 },
    );
  }
}
