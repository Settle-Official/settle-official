import { NextRequest, NextResponse } from "next/server";
import {
  listPendingBridges,
  getOnrampOrder,
  updateOnrampOrder,
  removePendingBridge,
} from "@/lib/onramp/onramp-store";
import {
  initializeAllbridgeSdk,
  getAllbridgeTransferStatus,
} from "@/lib/offramp/adapters/allbridge-adapter";
import { notify, alertManualAction } from "@/lib/notify/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

// If a bridge hasn't confirmed within this window, escalate for manual review
// (funds may be stuck) but keep watching.
const STALE_MS = 30 * 60 * 1000; // 30 min

/**
 * Finalizer: watches in-flight Base→Stellar bridges and marks orders
 * `delivered` once Allbridge confirms. Runs on a schedule (Vercel cron) so it
 * works even when the user has closed their tab. Idempotent — safe to run as
 * often as the cron fires.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. In production
 * we require it; if CRON_SECRET is unset we allow the call (local/dev).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const orderIds = await listPendingBridges();
  if (orderIds.length === 0) {
    return NextResponse.json({ checked: 0, delivered: 0 });
  }

  const sdk = await initializeAllbridgeSdk();

  let delivered = 0;
  let stillPending = 0;
  const now = Date.now();

  for (const orderId of orderIds) {
    try {
      const record = await getOnrampOrder(orderId);

      // Order gone or no longer bridging — stop watching it.
      if (!record || record.status !== "bridging" || !record.bridgeTxHash) {
        await removePendingBridge(orderId);
        continue;
      }

      // Source chain for this leg is Base ("BAS").
      const transfer = await getAllbridgeTransferStatus(
        sdk,
        "BAS",
        record.bridgeTxHash,
      );

      if (transfer.status === "completed") {
        await updateOnrampOrder(orderId, {
          status: "delivered",
          stellarTxHash: transfer.txHash,
        });
        await removePendingBridge(orderId);
        delivered++;
        void notify(
          `Onramp <code>${orderId}</code> delivered to Stellar ✓` +
            (record.baseUsdcAmount ? ` (${record.baseUsdcAmount} USDC)` : ""),
          "success",
        );
        continue;
      }

      if (transfer.status === "failed") {
        // Bridge reported failure — hold and escalate; do not auto-retry.
        await updateOnrampOrder(orderId, {
          status: "bridge_failed",
          failureReason: "Allbridge reported transfer failed",
        });
        await removePendingBridge(orderId);
        await alertManualAction({
          title: "Onramp bridge failed on-chain",
          orderId,
          amount: record.baseUsdcAmount,
          currency: "USDC",
          stellarAddress: record.userStellarAddress,
          reason: `Allbridge transfer ${record.bridgeTxHash} failed.`,
        });
        continue;
      }

      // Still in flight. Escalate once if it's been stuck too long, but keep
      // watching (don't remove from the set).
      stillPending++;
      const startedAt = record.bridgeStartedAt ?? record.updatedAt;
      if (now - startedAt > STALE_MS && !record.staleAlerted) {
        await updateOnrampOrder(orderId, { staleAlerted: true });
        void alertManualAction({
          title: "Onramp bridge slow to confirm",
          orderId,
          amount: record.baseUsdcAmount,
          currency: "USDC",
          stellarAddress: record.userStellarAddress,
          reason:
            `Bridge ${record.bridgeTxHash} still not confirmed after ` +
            `${Math.round((now - startedAt) / 60000)} min.`,
        });
      }
    } catch {
      // Transient error on one order shouldn't stop the sweep.
      stillPending++;
    }
  }

  return NextResponse.json({
    checked: orderIds.length,
    delivered,
    stillPending,
  });
}
