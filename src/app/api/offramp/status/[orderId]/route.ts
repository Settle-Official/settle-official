import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const paycrest = new PaycrestAdapter(paycrestApiKey);
    const orderStatus = await paycrest.getOrderStatus(orderId);

    return NextResponse.json({ data: orderStatus });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch order status" },
      { status: 500 }
    );
  }
}
