import { NextRequest, NextResponse } from "next/server";

const SOROBAN_RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ||
  "https://soroban-rpc.mainnet.stellar.gateway.fm";

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
 * Lightweight endpoint to check Stellar transaction confirmation status.
 * Returns: { status: "SUCCESS" | "FAILED" | "NOT_FOUND", hash }
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
    const txResult = await sorobanRpc("getTransaction", { hash });
    return NextResponse.json({
      hash,
      status: txResult?.status || "NOT_FOUND",
    });
  } catch (error: any) {
    console.error("[tx-status] Error checking tx:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to check transaction status" },
      { status: 500 },
    );
  }
}
