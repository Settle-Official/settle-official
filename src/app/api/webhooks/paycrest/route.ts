import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { mapPaycrestStatus } from "@/lib/offramp/adapters/paycrest-adapter";

function verifyPaycrestSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const hash = createHmac("sha256", secret).update(body).digest("hex");
  return hash === signature;
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("X-Paycrest-Signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 401 }
      );
    }

    const webhookSecret = process.env.PAYCREST_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("PAYCREST_WEBHOOK_SECRET not configured");
    }

    const body = await request.text();

    // Verify signature
    if (!verifyPaycrestSignature(body, signature, webhookSecret)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    const webhookData = JSON.parse(body);
    console.log("Paycrest webhook received:", webhookData);

    const { event, data } = webhookData;
    const payoutStatus = mapPaycrestStatus(event);

    // Here you would typically:
    // 1. Update your database with the new status
    // 2. Notify the user via websocket/SSE
    // 3. Trigger any post-processing logic

    console.log(`Order ${data.id} status updated to: ${payoutStatus}`);

    // TODO: Implement persistent storage
    // await db.trade.update({
    //   where: { payoutOrderId: data.id },
    //   data: { payoutStatus, updatedAt: new Date() }
    // });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: error.message || "Webhook processing failed" },
      { status: 500 }
    );
  }
}
