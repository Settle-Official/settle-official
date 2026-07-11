import { NextRequest, NextResponse } from "next/server";
import { getOnrampOrder } from "@/lib/onramp/onramp-store";

/**
 * Onramp order status. Redis is the source of truth (webhook + bridge driven),
 * so this reads the stored record directly. Sensitive fields (refund details)
 * are never stored here; only status + bridge progress is returned.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await params;
    const record = await getOnrampOrder(orderId);

    if (!record) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        id: record.orderId,
        status: record.status,
        stellarTxHash: record.stellarTxHash,
        bridgeTxHash: record.bridgeTxHash,
        updatedAt: record.updatedAt,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch onramp order status" },
      { status: 500 },
    );
  }
}
