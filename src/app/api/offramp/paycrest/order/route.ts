import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.PAYCREST_API_KEY;
    if (!apiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const body = await request.json();
    const amount = Number(body?.amount);
    const rate = Number(body?.rate);
    const token = String(body?.token || "").toUpperCase();
    const network = String(body?.network || "base").toLowerCase();
    const reference = String(body?.reference || "");
    const returnAddress = String(body?.returnAddress || "");
    const providerId = body?.recipient?.providerId
      ? String(body.recipient.providerId).trim()
      : "";

    const recipient = {
      institution: String(body?.recipient?.institution || "").trim(),
      accountIdentifier: String(body?.recipient?.accountIdentifier || "").trim(),
      accountName: String(body?.recipient?.accountName || "").trim(),
      memo: body?.recipient?.memo
        ? String(body.recipient.memo).trim()
        : "Stellaramp offramp",
      metadata: body?.recipient?.metadata ?? {},
      currency: String(body?.recipient?.currency || "").toUpperCase(),
    };

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !token ||
      !returnAddress ||
      !recipient.institution ||
      !recipient.accountIdentifier ||
      !recipient.accountName ||
      !recipient.currency
    ) {
      return NextResponse.json(
        {
          error: "Invalid order payload",
          message: "One or more required fields are missing/invalid",
          details: {
            amount,
            rate,
            token,
            network,
            hasReturnAddress: Boolean(returnAddress),
            recipient,
          },
        },
        { status: 400 }
      );
    }

    const normalizedPayload = {
      amount,
      token,
      rate,
      network,
      recipient: {
        ...recipient,
        ...(providerId ? { providerId } : {}),
      },
      reference: reference || undefined,
      returnAddress,
    };

    console.log("Creating Paycrest order with request:", {
      amount: normalizedPayload.amount,
      token: normalizedPayload.token,
      network: normalizedPayload.network,
      currency: normalizedPayload.recipient.currency,
      institution: normalizedPayload.recipient.institution,
      accountIdentifier: normalizedPayload.recipient.accountIdentifier,
      reference: normalizedPayload.reference,
    });

    const paycrest = new PaycrestAdapter(apiKey);

    const order = await paycrest.createOrder(normalizedPayload as any);
    console.log("Paycrest order created successfully:", {
      orderId: order.id,
      receiveAddress: order.receiveAddress,
    });
    
    return NextResponse.json({ data: order });
  } catch (error: any) {
    const statusCode =
      typeof error?.status === "number" && error.status >= 400
        ? error.status
        : 500;

    console.error("Paycrest create order error:", {
      message: error.message,
      status: error?.status,
      details: error?.details,
      stack: error.stack,
    });

    return NextResponse.json(
      { 
        error: error.message || "Failed to create Paycrest order",
        message: error.message,
        details: error?.details || null,
      },
      { status: statusCode }
    );
  }
}
