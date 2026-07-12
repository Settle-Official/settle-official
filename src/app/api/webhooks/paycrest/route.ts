import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { mapPaycrestStatus } from "@/lib/offramp/adapters/paycrest-adapter";
import { setPayoutStatus } from "@/lib/offramp/payout-store";
import type { PayoutStatus, OnrampStatus } from "@/lib/offramp/types";
import { updateOnrampOrder } from "@/lib/onramp/onramp-store";
import { handleOnrampSettled } from "@/lib/onramp/handle-settlement";
import { notify, alertOfframpEvent } from "@/lib/notify/telegram";
import { getOrderMeta } from "@/lib/offramp/order-meta-store";

// Needs Node's crypto and the raw request body; keep off the edge runtime.
export const runtime = "nodejs";
// Onramp `settled` triggers the Base→Stellar bridge inline (approve + broadcast).
// Give it room; the bridge lock prevents a retry from double-spending.
export const maxDuration = 60;

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
      data?: {
        id?: string;
        status?: string;
        amount?: string;
        txHash?: string;
        direction?: string;
      };
    };

    // Confirmation ping: every verified delivery lands here. Lets you see in
    // Telegram that webhooks are actually reaching the deployment.
    void notify(
      `📥 Webhook received: <code>${event ?? "?"}</code>` +
        ` · ${data?.direction ?? "offramp"} · order <code>${data?.id ?? "?"}</code>`,
      "info",
    );

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

    // Route by direction. Onramp needs the custodial Base→Stellar bridge; the
    // existing offramp path just persists status for the client SSE stream.
    if (data?.direction === "onramp") {
      await updateOnrampOrder(orderId, {
        status: status as OnrampStatus,
        ...(data?.amount ? { baseUsdcAmount: data.amount } : {}),
      });

      if (status === "settled") {
        // Bridge inline. handleOnrampSettled is lock-guarded and hold-and-alert
        // on failure, so it's safe under Paycrest's retries.
        await handleOnrampSettled(orderId, data?.amount);
      } else if (status === "refunded" || status === "expired") {
        void notify(
          `Onramp <code>${orderId}</code> ${status}` +
            (data?.amount ? ` (${data.amount})` : ""),
          "warning",
        );
      }

      return NextResponse.json({ success: true });
    }

    // --- Offramp (existing behavior) ---
    await setPayoutStatus(orderId, {
      status,
      amount: data?.amount,
      txHash: data?.txHash,
      event,
    });

    // Rich alert on EVERY status change, enriched with the bank details / rate
    // / payout value captured at order creation (the webhook payload lacks
    // them). Fires regardless of status — success, fail, or intermediate.
    const meta = await getOrderMeta(orderId);
    void alertOfframpEvent({
      orderId,
      status,
      accountName: meta?.accountName,
      accountNumber: meta?.accountIdentifier,
      bank: meta?.institution,
      currency: meta?.currency,
      amountUsdc: meta?.amountUsdc ?? data?.amount,
      rate: meta?.rate,
      payoutValue: meta?.payoutValue,
      reference: meta?.reference,
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
