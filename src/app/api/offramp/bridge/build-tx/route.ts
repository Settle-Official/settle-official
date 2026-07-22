import { NextRequest, NextResponse } from "next/server";
import { createNextBridgeTx } from "@/lib/offramp/adapters/allbridge-next-adapter";
import {
  validateAmount,
  validateAddress,
} from "@/lib/offramp/utils/validation";

// Allow up to 30s for the Allbridge Next API round trip
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress, feePaymentMethod } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json(
        { error: "Invalid Stellar address" },
        { status: 400 },
      );
    }
    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json(
        { error: "Invalid Base address" },
        { status: 400 },
      );
    }

    const selectedMethod: "native" | "stablecoin" =
      feePaymentMethod === "native" ? "native" : "stablecoin";

    const result = await createNextBridgeTx({
      amountFloat: amount,
      sourceAddress: fromAddress,
      destinationAddress: toAddress,
      feePaymentMethod: selectedMethod,
    });

    return NextResponse.json({
      xdr: result.tx.tx,
      sourceToken: "USDC",
      destinationToken: "USDC",
    });
  } catch (error: any) {
    let userMessage = error.message || "Failed to build transaction";
    const msg = error.message || "";

    if (msg.includes("resulting balance is not within the allowed range")) {
      userMessage =
        "Insufficient XLM balance for the native gas fee. " +
        "Your remaining XLM would fall below Stellar's minimum account reserve. " +
        "Switch to USDC fee payment or add more XLM to your wallet.";
    } else if (
      msg.includes("contract call failed") &&
      msg.includes("transfer")
    ) {
      userMessage =
        "A token transfer in the bridge contract failed during simulation. " +
        "This usually means insufficient balance for the amount + fees.";
    }

    return NextResponse.json(
      {
        error: userMessage,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
