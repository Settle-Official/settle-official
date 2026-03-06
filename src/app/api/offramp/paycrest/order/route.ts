import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.PAYCREST_API_KEY;
    if (!apiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const body = await request.json();
    console.log("Creating Paycrest order with request:", {
      amount: body.amount,
      token: body.token,
      network: body.network,
      currency: body.recipient?.currency,
      reference: body.reference,
    });

    const paycrest = new PaycrestAdapter(apiKey);

    const order = await paycrest.createOrder(body);
    console.log("Paycrest order created successfully:", {
      orderId: order.id,
      receiveAddress: order.receiveAddress,
    });
    
    return NextResponse.json({ data: order });
  } catch (error: any) {
    console.error("Paycrest create order error:", {
      message: error.message,
      stack: error.stack,
    });
    return NextResponse.json(
      { 
        error: error.message || "Failed to create Paycrest order",
        message: error.message 
      },
      { status: 500 }
    );
  }
}
