import { NextRequest } from "next/server";
import {
  getOnrampOrder,
  isTerminal,
  type OnrampRecord,
} from "@/lib/onramp/onramp-store";
import { finalizeOnrampOrder } from "@/lib/onramp/finalize";
import { initializeAllbridgeSdk } from "@/lib/offramp/adapters/allbridge-adapter";

export const runtime = "nodejs";
export const maxDuration = 60;

const POLL_MS = 3000;
// Check the Allbridge transfer at most this often while bridging. Much slower
// than the Redis read so we don't hammer the bridge API or re-init the SDK too
// eagerly.
const BRIDGE_CHECK_MS = 15000;

/**
 * Streams onramp order status to the browser. Reads the Redis record (written
 * by the order route, webhook, and bridge handler) and pushes on change.
 *
 * While the order is `bridging`, this also drives delivery confirmation: it
 * calls the shared finalizer (checks Allbridge → flips delivered/failed) on a
 * slow cadence. On Vercel Hobby the cron only runs daily, so this open-tab path
 * is what confirms delivery promptly. The finalizer is idempotent and shared
 * with the cron, so both racing is harmless.
 *
 * Closes on a terminal state (delivered / refunded / expired). EventSource
 * auto-reconnects across the Vercel timeout; each connect re-reads Redis, so no
 * state is lost. `bridge_failed` is streamed but not closed — resolution may
 * move it forward.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastSerialized = "";
      let lastBridgeCheck = 0;
      // Lazily initialized the first time we actually need to check the bridge.
      let sdkPromise: Promise<any> | null = null;

      const send = (record: OnrampRecord) => {
        // Only surface fields the client needs; omit stored PII.
        const payload = {
          id: record.orderId,
          status: record.status,
          bridgeTxHash: record.bridgeTxHash,
          stellarTxHash: record.stellarTxHash,
          updatedAt: record.updatedAt,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const record = await getOnrampOrder(orderId);
          if (!record) return;

          // Drive delivery confirmation while bridging (throttled). The
          // finalizer writes to Redis; this same loop then pushes the change.
          if (
            record.status === "bridging" &&
            Date.now() - lastBridgeCheck > BRIDGE_CHECK_MS
          ) {
            lastBridgeCheck = Date.now();
            try {
              if (!sdkPromise) sdkPromise = initializeAllbridgeSdk();
              const sdk = await sdkPromise;
              await finalizeOnrampOrder(sdk, orderId);
            } catch {
              // Bridge check failed this round — retry on the next interval.
            }
          }

          const serialized = JSON.stringify(record);
          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            send(record);
          }

          if (isTerminal(record.status)) {
            close();
          }
        } catch {
          // Transient error — keep the stream open, retry next tick.
        }
      };

      const interval = setInterval(tick, POLL_MS);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
