import { CCTP_CONFIG } from "./constants";

export interface AttestationMessage {
  message: string;
  attestation: string;
  status: string;
  eventNonce?: string;
}

interface AttestationResponse {
  messages: AttestationMessage[];
}

export interface BurnFeeQuote {
  /** Fee in the burn token's smallest unit (matches source-chain decimals), as a string. */
  minimumFee: string;
}

export function buildMessagesUrl(
  baseUrl: string,
  sourceDomain: number,
  transactionHash: string,
): string {
  return `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
}

export function buildFeeQuoteUrl(
  baseUrl: string,
  sourceDomain: number,
  destDomain: number,
): string {
  return `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`;
}

/**
 * Single-shot attestation fetch (no internal polling loop — the caller
 * decides cadence, since offramp/onramp drive this from different places:
 * SSE tick vs daily cron sweep). Returns null while still pending; throws on
 * a real HTTP error other than 404 (not-found-yet is expected while pending).
 */
export async function fetchAttestation(params: {
  sourceDomain: number;
  transactionHash: string;
}): Promise<AttestationMessage | null> {
  const url = buildMessagesUrl(
    CCTP_CONFIG.irisApiUrl,
    params.sourceDomain,
    params.transactionHash,
  );
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Iris /v2/messages failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as AttestationResponse;
  const first = data.messages?.[0];
  if (!first || first.status !== "complete") return null;
  return first;
}

/** Real, live fee quote — replaces the old flat/guessed Allbridge relayer fee. */
export async function getBurnFeeQuote(params: {
  sourceDomain: number;
  destDomain: number;
}): Promise<BurnFeeQuote> {
  const url = buildFeeQuoteUrl(
    CCTP_CONFIG.irisApiUrl,
    params.sourceDomain,
    params.destDomain,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Iris fee quote failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  // Response is an array of finality-threshold-keyed fee entries; take the
  // Fast Transfer (finalityThreshold: 1000) entry's minimumFee.
  const fast = Array.isArray(data)
    ? data.find((e: any) => e.finalityThreshold === 1000)
    : undefined;
  return { minimumFee: String(fast?.minimumFee ?? "0") };
}

/** Recover an expired/stuck Fast Transfer attestation. */
export async function reattest(nonce: string): Promise<void> {
  const res = await fetch(`${CCTP_CONFIG.irisApiUrl}/v2/reattest/${nonce}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Iris reattest failed: ${res.status} ${await res.text()}`);
  }
}
