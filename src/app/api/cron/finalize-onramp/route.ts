import { NextRequest, NextResponse } from "next/server";
import { listPendingBridges } from "@/lib/onramp/onramp-store";
import { initializeAllbridgeSdk } from "@/lib/offramp/adapters/allbridge-adapter";
import { finalizeOnrampOrder } from "@/lib/onramp/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Backstop finalizer: sweeps all in-flight Base→Stellar bridges and advances
 * any that have confirmed. On Vercel Hobby this only fires once per day (the
 * open SSE session is the fast path); on Pro it can run every couple minutes.
 * Idempotent — safe at any cadence.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. Required in
 * production; if CRON_SECRET is unset the call is allowed (local/dev).
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

  for (const orderId of orderIds) {
    try {
      const outcome = await finalizeOnrampOrder(sdk, orderId);
      if (outcome === "delivered") delivered++;
      else if (outcome === "pending") stillPending++;
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
