import { NextRequest } from "next/server";
import {
  getPayoutStatus,
  isTerminal,
  type PayoutRecord,
} from "@/lib/offramp/payout-store";

export const runtime = "nodejs";
// Vercel function ceiling. When it's hit, EventSource auto-reconnects and the
// stream re-reads Redis, so no update is lost across the boundary.
export const maxDuration = 60;

const POLL_MS = 3000;

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

      const send = (record: PayoutRecord) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(record)}\n\n`),
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

      // Stop work if the client disconnects.
      request.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const record = await getPayoutStatus(orderId);
          if (!record) return; // nothing yet; keep the connection open

          const serialized = JSON.stringify(record);
          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            send(record);
          }

          if (isTerminal(record.status)) {
            close();
          }
        } catch {
          // Transient Redis error — keep the stream alive and retry next tick.
        }
      };

      const interval = setInterval(tick, POLL_MS);
      await tick(); // emit current state immediately on connect
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
