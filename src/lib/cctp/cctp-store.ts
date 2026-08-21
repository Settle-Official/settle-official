import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TTL_SECONDS = 7 * 24 * 60 * 60;
const key = (id: string) => `cctp:transfer:${id}`;
const PENDING_KEY = "cctp:pending-transfers";

export type CctpStatus =
  | "burned"
  | "attesting"
  | "attested"
  | "minting"
  | "completed"
  | "failed";

export const STATUS_RANK: Record<CctpStatus, number> = {
  burned: 0,
  attesting: 1,
  attested: 2,
  minting: 3,
  completed: 4,
  failed: 4, // terminal, same rank as completed — either ends progression
};

export interface CctpTransferRecord {
  id: string;
  direction: "offramp" | "onramp";
  sourceDomain: number;
  destDomain: number;
  burnTxHash: string;
  mintRecipient: string;
  status: CctpStatus;
  attestationMessage?: string;
  attestationSignature?: string;
  mintTxHash?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  paycrestOrderId?: string;
}

export async function createCctpTransfer(
  record: Omit<CctpTransferRecord, "createdAt" | "updatedAt" | "attempts">,
): Promise<CctpTransferRecord> {
  const now = Date.now();
  const full: CctpTransferRecord = { ...record, attempts: 0, createdAt: now, updatedAt: now };
  await redis.set(key(record.id), full, { ex: TTL_SECONDS });
  await addPendingTransfer(record.id);
  return full;
}

export async function getCctpTransfer(id: string): Promise<CctpTransferRecord | null> {
  return (await redis.get<CctpTransferRecord>(key(id))) ?? null;
}

export async function updateCctpTransfer(
  id: string,
  patch: Partial<Omit<CctpTransferRecord, "id" | "createdAt">>,
): Promise<CctpTransferRecord | null> {
  const existing = await getCctpTransfer(id);
  if (!existing) return null;

  const merged: CctpTransferRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await redis.set(key(id), merged, { ex: TTL_SECONDS });
  if (merged.status === "completed" || merged.status === "failed") {
    await removePendingTransfer(id);
  }
  return merged;
}

export async function addPendingTransfer(id: string): Promise<void> {
  await redis.sadd(PENDING_KEY, id);
}

export async function removePendingTransfer(id: string): Promise<void> {
  await redis.srem(PENDING_KEY, id);
}

export async function listPendingTransfers(): Promise<string[]> {
  return (await redis.smembers(PENDING_KEY)) ?? [];
}
