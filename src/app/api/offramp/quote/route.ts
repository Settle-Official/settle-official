import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import {
  getAllbridgeQuote,
  getAllbridgeTokens,
  initializeAllbridgeSdk,
} from "@/lib/offramp/adapters/allbridge-adapter";
import {
  validateAmount,
  validateToken,
  validateCurrency,
} from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, token, currency, network, provider_id, isFiatInput } = body;

    // Validation
    if (!validateAmount(amount)) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    if (!validateToken(token)) {
      return NextResponse.json(
        { error: "Invalid or unsupported token" },
        { status: 400 }
      );
    }

    if (!validateCurrency(currency)) {
      return NextResponse.json(
        { error: "Invalid or unsupported currency" },
        { status: 400 }
      );
    }

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const paycrest = new PaycrestAdapter(paycrestApiKey);

    let sourceAmount: string;
    let destinationAmount: string;
    let rate: number;

    // Current UI flow uses USDC input mode.
    // For fiat-input mode, fallback to same path for now with the provided amount.
    const amountForBridge = isFiatInput ? amount : amount;

    // 1) Allbridge: get amount received on Base USDC after bridge fee
    const sdk = await initializeAllbridgeSdk();
    const tokens = await getAllbridgeTokens(sdk);
    if (!tokens.stellar.usdc || !tokens.base.usdc) {
      throw new Error("USDC tokens not found on Allbridge");
    }

    const bridgeQuote = await getAllbridgeQuote(
      sdk,
      tokens.stellar.usdc,
      tokens.base.usdc,
      amountForBridge
    );
    const amountAfterBridge = parseFloat(bridgeQuote.receiveAmount);

    // 2) Paycrest: convert post-bridge USDC amount to NGN rate/output
    rate = await paycrest.getRate(token, bridgeQuote.receiveAmount, currency, {
      network: network || "base",
      providerId: provider_id,
    });

    // 3) Platform fee: 0.5%
    const grossNgn = amountAfterBridge * rate;
    const platformFeeRate = 0.005;
    const netNgn = grossNgn * (1 - platformFeeRate);

    sourceAmount = amount;
    destinationAmount = netNgn.toFixed(2);

    // Fees
    const bridgeFee = bridgeQuote.fee;
    const payoutFee = (grossNgn * platformFeeRate).toFixed(2);

    // Estimated time: Allbridge (3 min) + Paycrest (2 min)
    const estimatedTime = 5 * 60 * 1000; // 5 minutes in ms

    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return NextResponse.json({
      quoteId,
      sourceAmount,
      destinationAmount,
      bridgeFee,
      payoutFee,
      amountAfterBridge: bridgeQuote.receiveAmount,
      rate,
      estimatedTime,
      validUntil: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes validity
    });
  } catch (error: any) {
    console.error("Quote error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate quote" },
      { status: 500 }
    );
  }
}
