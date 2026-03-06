import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const apiKey = process.env.PAYCREST_API_KEY;
    if (!apiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const { orderId } = await params;
    const paycrest = new PaycrestAdapter(apiKey);
    const status = await paycrest.getOrderStatus(orderId);

    return NextResponse.json({ data: status });
  } catch (error: any) {
    console.error("Paycrest order status error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch Paycrest order status" },
      { status: 500 }
    );
  }
}
