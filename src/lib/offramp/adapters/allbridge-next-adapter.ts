/**
 * Thin REST client for Allbridge Next's API (api.next.allbridge.io).
 *
 * This is NOT a documented/public API — there is no SDK and no docs. The shape
 * used here was reverse-engineered by inspecting next.allbridge.io's own network
 * traffic and minified JS bundle for the SRB:USDC -> BAS:USDC route. Allbridge
 * Core (the officially-supported @allbridge/bridge-core-sdk) no longer supports
 * this chain pair for any messenger — see
 * docs/superpowers/specs/2026-07-22-offramp-bridge-allbridge-next-route-design.md
 * for the full investigation.
 */

import { floatToInt } from "./soroban-tx-builder";

const NEXT_API_URL =
  process.env.ALLBRIDGE_NEXT_API_URL || "https://api.next.allbridge.io";

const STELLAR_USDC_TOKEN_ID = "SRB:USDC";
const BASE_USDC_TOKEN_ID = "BAS:USDC";

// Both plausible relayer-fee tokens on the Stellar side (native XLM stroops,
// and Stellar USDC) use 7 decimals, so one constant covers both.
export const STELLAR_USDC_DECIMALS = 7;
export const BASE_USDC_DECIMALS = 6;

export interface NextRelayerFee {
  tokenId: string;
  amount: string;
  approvalSpender?: string;
}

export interface NextQuote {
  sourceTokenId: string;
  destinationTokenId: string;
  messenger: string;
  amount: string;
  amountOut: string;
  amountOutMin: string;
  relayerFees: NextRelayerFee[];
  estimatedTime: number;
  [key: string]: unknown;
}

export interface NextBridgeTxResult {
  tx: string;
  amountOut?: string;
  [key: string]: unknown;
}

export interface NextTransferStatus {
  status: "pending" | "processing" | "completed" | "failed";
  txHash?: string;
}

export interface BridgeFeeOptionsNext {
  native: { int: string; float: string };
  stablecoin: { int: string; float: string };
}

export function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

async function nextApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NEXT_API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Allbridge Next API ${path} failed: ${res.status} ${bodyText}`);
  }
  return res.json();
}

/**
 * Get a bridge quote for SRB:USDC -> BAS:USDC.
 * amountFloat is a human-readable string, e.g. "50" or "50.5".
 */
export async function getNextQuote(amountFloat: string): Promise<NextQuote> {
  const amountInt = floatToInt(amountFloat, STELLAR_USDC_DECIMALS);
  const quotes = await nextApiFetch<NextQuote[]>("/quote", {
    method: "POST",
    body: JSON.stringify({
      sourceTokenId: STELLAR_USDC_TOKEN_ID,
      destinationTokenId: BASE_USDC_TOKEN_ID,
      amount: amountInt,
    }),
  });
  const quote = quotes?.[0];
  if (!quote) {
    throw new Error("Allbridge Next returned no quote for SRB:USDC -> BAS:USDC");
  }
  return quote;
}

/**
 * Derive UI-facing fee options from a quote's relayerFees. Either bucket may
 * come back as "0" if Allbridge Next doesn't offer that payment method for
 * this route — callers must treat "0" as "unavailable", not "free".
 */
export async function getNextGasFeeOptions(
  amountFloat: string,
): Promise<BridgeFeeOptionsNext> {
  const quote = await getNextQuote(amountFloat);
  const nativeFee = quote.relayerFees.find((f) => f.tokenId === "native");
  const stablecoinFee = quote.relayerFees.find(
    (f) => f.tokenId === quote.sourceTokenId,
  );
  return {
    native: {
      int: nativeFee?.amount || "0",
      float: nativeFee ? intToFloat(nativeFee.amount, STELLAR_USDC_DECIMALS) : "0",
    },
    stablecoin: {
      int: stablecoinFee?.amount || "0",
      float: stablecoinFee
        ? intToFloat(stablecoinFee.amount, STELLAR_USDC_DECIMALS)
        : "0",
    },
  };
}

/**
 * Build an unsigned bridge transaction via Allbridge Next's /tx/create.
 * Returns the raw `tx` payload (XDR, since the source chain is Stellar) —
 * the caller signs it with the user's wallet exactly like the existing
 * Allbridge Core XDR flow, and submits via the existing submit-soroban route.
 */
export async function createNextBridgeTx(params: {
  amountFloat: string;
  sourceAddress: string;
  destinationAddress: string;
  feePaymentMethod: "native" | "stablecoin";
}): Promise<NextBridgeTxResult> {
  const { amountFloat, sourceAddress, destinationAddress, feePaymentMethod } = params;
  const quote = await getNextQuote(amountFloat);
  const { relayerFees, ...quoteRest } = quote;
  const wantedTokenId = feePaymentMethod === "native" ? "native" : quote.sourceTokenId;
  const relayerFee = relayerFees.find((f) => f.tokenId === wantedTokenId);
  if (!relayerFee) {
    throw new Error(
      `Allbridge Next did not return a "${feePaymentMethod}" relayer fee option for this route`,
    );
  }

  const body = {
    ...quoteRest,
    amount: floatToInt(amountFloat, STELLAR_USDC_DECIMALS),
    sourceAddress,
    destinationAddress,
    relayerFee,
  };

  const result = await nextApiFetch<NextBridgeTxResult>("/tx/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result?.tx || typeof result.tx !== "string") {
    throw new Error("Allbridge Next /tx/create returned no usable tx payload");
  }
  return result;
}

/**
 * Best-effort transfer status lookup. Never throws — callers treat this as
 * background polling info, not a gate (Paycrest's own payout detection is
 * the real completion signal). The exact query param name below (`txHash`)
 * is a best guess reverse-engineered from the bundle and unverified against
 * a live response; a wrong name just means this always reports "pending",
 * which is a safe (if uninformative) failure mode.
 */
export async function getNextTransferStatus(
  txHash: string,
): Promise<NextTransferStatus> {
  try {
    const result = await nextApiFetch<any>(
      `/transfer/status?txHash=${encodeURIComponent(txHash)}`,
    );
    const rawStatus = String(result?.status || "").toLowerCase();
    const status: NextTransferStatus["status"] =
      rawStatus === "completed"
        ? "completed"
        : rawStatus === "failed" || rawStatus === "refunded"
          ? "failed"
          : rawStatus === "processing"
            ? "processing"
            : "pending";
    return { status, txHash: result?.txHash || txHash };
  } catch {
    return { status: "pending", txHash };
  }
}
