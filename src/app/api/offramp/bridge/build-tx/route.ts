import { NextRequest, NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTokens,
  buildAllbridgeSendTx,
} from "@/lib/offramp/adapters/allbridge-adapter";
import { validateAmount, validateAddress } from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress } = body;

    // Validation
    if (!validateAmount(amount)) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json(
        { error: "Invalid Stellar address" },
        { status: 400 }
      );
    }

    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json(
        { error: "Invalid Base address" },
        { status: 400 }
      );
    }

    // Initialize Allbridge SDK
    const sdk = await initializeAllbridgeSdk();
    const tokens = await getAllbridgeTokens(sdk);

    if (!tokens.stellar.usdc || !tokens.base.usdc) {
      throw new Error("USDC tokens not found on Allbridge");
    }

    // Build transaction XDR
    const xdr = await buildAllbridgeSendTx(sdk, {
      amount,
      fromAddress,
      toAddress,
      sourceToken: tokens.stellar.usdc,
      destinationToken: tokens.base.usdc,
    });

    return NextResponse.json({
      xdr,
      sourceToken: tokens.stellar.usdc.symbol,
      destinationToken: tokens.base.usdc.symbol,
    });
  } catch (error: any) {
    console.error("Build transaction error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to build transaction" },
      { status: 500 }
    );
  }
}
