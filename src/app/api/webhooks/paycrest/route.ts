import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { mapPaycrestStatus } from "@/lib/offramp/adapters/paycrest-adapter";
import { setPayoutStatus } from "@/lib/offramp/payout-store";
import type { PayoutStatus } from "@/lib/offramp/types";

// Needs Node's crypto and the raw request body; keep off the edge runtime.
export const runtime = "nodejs";

const KNOWN_STATUSES: ReadonlySet<string> = new Set<PayoutStatus>([
  "pending",
  "deposited",
  "validated",
  "settling",
  "settled",
  "refunding",
  "refunded",
  "expired",
  "unknown",
]);

function verifyPaycrestSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch — treat that as "not equal".
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("X-Paycrest-Signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    const webhookSecret = process.env.PAYCREST_WEBHOOK_SECRET;
    if (!webhookSecret) {
      // Config error, not the caller's fault — 500 so failures are visible.
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }

    // Read the RAW body before parsing — the HMAC is computed over these exact
    // bytes, so parsing first would break verification.
    const body = await request.text();

    if (!verifyPaycrestSignature(body, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const { event, data } = JSON.parse(body) as {
      event?: string;
      data?: { id?: string; status?: string; amount?: string; txHash?: string };
    };

    const orderId = data?.id;
    if (!orderId) {
      // Verified but unusable — ack so Paycrest doesn't retry a malformed one.
      return NextResponse.json({ success: true, ignored: true });
    }

    // Prefer the bare status from the v2 payload; fall back to mapping the
    // event name when it's missing or unrecognised.
    const rawStatus = data?.status;
    const status: PayoutStatus =
      rawStatus && KNOWN_STATUSES.has(rawStatus)
        ? (rawStatus as PayoutStatus)
        : mapPaycrestStatus(event ?? "");

    await setPayoutStatus(orderId, {
      status,
      amount: data?.amount,
      txHash: data?.txHash,
      event,
    });

    // 2xx quickly so Paycrest marks the delivery successful.
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Webhook processing failed" },
      { status: 500 },
    );
  }
}
