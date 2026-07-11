import { NextRequest } from "next/server";
import {
  getOnrampOrder,
  isTerminal,
  type OnrampRecord,
} from "@/lib/onramp/onramp-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const POLL_MS = 3000;

/**
 * Streams onramp order status to the browser. Reads the Redis record (written
 * by the order route, webhook, and bridge handler) and pushes on change.
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
