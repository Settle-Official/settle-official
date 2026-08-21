/**
 * On-demand status check for an onramp order — the handler behind the
 * "Check status" Telegram button. If the order is `bridging`, actively
 * re-checks its bridge right now instead of waiting for the once-daily cron
 * or an open SSE tab.
 *
 * Orders bridged via CCTP (the current default — carry a `cctpTransferId`)
 * are advanced via advanceCctpTransfer, same logic the onramp SSE stream
 * uses. Orders that predate the CCTP cutover (no `cctpTransferId`) fall back
 * to the legacy Allbridge finalizer so in-flight pre-cutover orders still
 * resolve correctly.
 *
 * If the order is `bridge_failed`, this actually retries the bridge (via
 * retryOnrampBridge) instead of just re-reporting the frozen failureReason
 * from whenever it originally failed — otherwise tapping "Check status"
 * after fixing the underlying issue (e.g. funding hot-wallet gas) would
 * forever echo the same stale error.
 */

import { getOnrampOrder, updateOnrampOrder } from "./onramp-store";
import { finalizeOnrampOrder } from "./finalize";
import { retryOnrampBridge } from "./retry-bridge";
import { initializeAllbridgeSdk } from "@/lib/offramp/adapters/allbridge-adapter";
import { getCctpTransfer } from "@/lib/cctp/cctp-store";
import { advanceCctpTransfer } from "@/lib/cctp/advance";

export interface StatusCheckResult {
  message: string;
  level: "info" | "success" | "warning";
  /**
   * True when finalizeOnrampOrder already posted a full delivered/failed
   * alert as a side effect of this check — the caller should only toast
   * `message`, not post it again as a second chat message.
   */
  alreadyAlerted?: boolean;
}

export async function checkOnrampStatus(
  orderId: string,
): Promise<StatusCheckResult> {
  const record = await getOnrampOrder(orderId);
  if (!record) {
    return { message: `Order ${orderId} not found.`, level: "warning" };
  }

  if (record.status === "bridging" && record.cctpTransferId) {
    const cctpStatus = await advanceCctpTransfer(record.cctpTransferId);
    if (cctpStatus === "completed") {
      const transfer = await getCctpTransfer(record.cctpTransferId);
      await updateOnrampOrder(orderId, {
        status: "delivered",
        stellarTxHash: transfer?.mintTxHash,
      });
      return { message: "Delivered ✓", level: "success" };
    }
    if (cctpStatus === "failed") {
      await updateOnrampOrder(orderId, {
        status: "bridge_failed",
        failureReason: "CCTP transfer failed after max retries",
      });
      return { message: "Failed — CCTP transfer exhausted retries", level: "warning" };
    }
    return {
      message: `Order ${orderId} is still bridging (CCTP status: ${cctpStatus}).`,
      level: "info",
    };
  }

  if (record.status === "bridging") {
    // Legacy pre-cutover order — no cctpTransferId, was bridged via Allbridge.
    const sdk = await initializeAllbridgeSdk();
    const outcome = await finalizeOnrampOrder(sdk, orderId);
    if (outcome === "delivered" || outcome === "failed") {
      // finalizeOnrampOrder already sent the full delivered/failed alert.
      return {
        message: outcome === "delivered" ? "Delivered ✓" : "Failed — see alert",
        level: outcome === "delivered" ? "success" : "warning",
        alreadyAlerted: true,
      };
    }
    return {
      message: `Order ${orderId} is still bridging — not yet confirmed on Stellar.`,
      level: "info",
    };
  }

  if (record.status === "bridge_failed") {
    // handleOnrampSettled (called inside retryOnrampBridge) already sends
    // its own success/failure alert, so this is always toast-only.
    const result = await retryOnrampBridge(orderId);
    return { message: result.message, level: result.ok ? "success" : "warning", alreadyAlerted: true };
  }

  const suffix = record.stellarTxHash ? ` (tx ${record.stellarTxHash})` : "";
  const reason = record.failureReason ? ` — ${record.failureReason}` : "";
  return {
    message: `Order ${orderId} status: ${record.status}${suffix}${reason}`,
    level: record.status === "delivered" ? "success" : "info",
  };
}
