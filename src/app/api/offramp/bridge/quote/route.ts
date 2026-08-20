import { NextRequest, NextResponse } from "next/server";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, STELLAR_USDC_DECIMALS } from "@/lib/cctp/constants";
import { validateAmount } from "@/lib/offramp/utils/validation";

function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

/**
 * Raw Stellar->Base USDC bridge receive amount (no Paycrest/fiat conversion —
 * see /api/offramp/quote for the fiat-facing quote). Used at execution time
 * to size the Paycrest payout order to what will actually arrive on Base.
 *
 * CCTP burns 1:1 minus a flat fee (no swap spread), unlike the old Allbridge
 * Next quote this replaced — so this is arithmetic against a live fee quote,
 * not a bridge-provided "amountOut".
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const feeQuote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    const bridgeFeeFloat = parseFloat(
      intToFloat(feeQuote.minimumFee, STELLAR_USDC_DECIMALS),
    );
    const receiveAmountFloat = parseFloat(amount) - bridgeFeeFloat;
    if (receiveAmountFloat <= 0) {
      return NextResponse.json(
        { error: "Amount is too small to cover the bridge fee" },
        { status: 400 },
      );
    }

    return NextResponse.json({ receiveAmount: receiveAmountFloat.toFixed(6) });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch bridge quote" },
      { status: 500 },
    );
  }
}
