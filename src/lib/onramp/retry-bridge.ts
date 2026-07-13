/**
 * Manual retry entry point for a stuck onramp bridge (e.g. USDC landed in the
 * hot wallet but bridging failed for lack of ETH gas). Shared by the admin
 * HTTP endpoint and the Telegram `/retry` command so both go through the same
 * reset + re-trigger sequence instead of duplicating it.
 */

import {
  getOnrampOrder,
  resetBridgeFailedForRetry,
} from "./onramp-store";
import { handleOnrampSettled } from "./handle-settlement";

const NOT_RETRYABLE: ReadonlySet<string> = new Set([
  "bridging",
  "delivered",
  "refunded",
]);

export interface RetryBridgeResult {
  ok: boolean;
  message: string;
  status?: string;
}

export async function retryOnrampBridge(
  orderId: string,
  amountOverride?: string,
): Promise<RetryBridgeResult> {
  const record = await getOnrampOrder(orderId);
  if (!record) {
    return { ok: false, message: `Order ${orderId} not found.` };
  }

  if (NOT_RETRYABLE.has(record.status)) {
    return {
      ok: false,
      message: `Order ${orderId} is already ${record.status}; nothing to retry.`,
      status: record.status,
    };
  }

  if (record.status === "bridge_failed") {
    await resetBridgeFailedForRetry(orderId);
  }

  const amount = amountOverride || record.baseUsdcAmount;
  if (!amount) {
    return {
      ok: false,
      message: `Order ${orderId} has no known USDC amount — retry with an explicit amount.`,
      status: record.status,
    };
  }

  await handleOnrampSettled(orderId, amount);

  const updated = await getOnrampOrder(orderId);
  const failed = updated?.status === "bridge_failed";
  return {
    ok: !failed,
    message: failed
      ? `Retry failed again: ${updated?.failureReason ?? "unknown reason"}`
      : `Retry triggered — order ${orderId} now ${updated?.status}.`,
    status: updated?.status,
  };
}
