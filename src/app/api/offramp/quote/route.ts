import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import {
  getNextQuote,
  getNextGasFeeOptions,
  intToFloat,
  BASE_USDC_DECIMALS,
} from "@/lib/offramp/adapters/allbridge-next-adapter";
import {
  validateAmount,
  validateToken,
  validateCurrency,
} from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, token, currency, network, provider_id, feePaymentMethod } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateToken(token)) {
      return NextResponse.json(
        { error: "Invalid or unsupported token" },
        { status: 400 },
      );
    }
    if (!validateCurrency(currency)) {
      return NextResponse.json(
        { error: "Invalid or unsupported currency" },
        { status: 400 },
      );
    }

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }
    const paycrest = new PaycrestAdapter(paycrestApiKey);

    // When paying the bridge fee in stablecoin, it's deducted from the input
    // amount before bridging — re-quote with the post-fee amount for accuracy.
    let amountForBridge = amount;
    if (feePaymentMethod === "stablecoin") {
      const feeOptions = await getNextGasFeeOptions(amount);
      const stableFee = parseFloat(feeOptions.stablecoin.float);
      const afterFee = parseFloat(amount) - stableFee;
      if (afterFee <= 0) {
        return NextResponse.json(
          { error: "Amount is too small to cover the bridge fee" },
          { status: 400 },
        );
      }
      amountForBridge = afterFee.toFixed(7);
    }

    // 1) Allbridge Next: get amount received on Base USDC after bridge fee
    const bridgeQuote = await getNextQuote(amountForBridge);
    const receiveAmount = intToFloat(bridgeQuote.amountOut, BASE_USDC_DECIMALS);
    const amountAfterBridge = parseFloat(receiveAmount);

    // 2) Paycrest: convert post-bridge USDC amount to fiat rate/output
    const rate = await paycrest.getRate(token, receiveAmount, currency, {
      network: network || "base",
      providerId: provider_id,
    });

    // 3) Platform fee: 0.5%
    const grossFiat = amountAfterBridge * rate;
    const platformFeeRate = 0.005;
    const netFiat = grossFiat * (1 - platformFeeRate);

    const sourceAmount = amount;
    const destinationAmount = netFiat.toFixed(2);
    const bridgeFee = (parseFloat(amount) - amountAfterBridge).toString();
    const payoutFee = (grossFiat * platformFeeRate).toFixed(2);

    // Estimated time: Allbridge Next's own estimate (seconds) + ~2min Paycrest
    const estimatedTime = bridgeQuote.estimatedTime * 1000 + 2 * 60 * 1000;

    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return NextResponse.json({
      quoteId,
      sourceAmount,
      destinationAmount,
      bridgeFee,
      payoutFee,
      amountAfterBridge: receiveAmount,
      rate,
      estimatedTime,
      validUntil: new Date(Date.now() + 5 * 60 * 1000),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to generate quote" },
      { status: 500 },
    );
  }
}
