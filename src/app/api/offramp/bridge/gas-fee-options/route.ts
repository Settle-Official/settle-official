import { NextResponse } from "next/server";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, STELLAR_USDC_DECIMALS } from "@/lib/cctp/constants";

function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

export async function GET() {
  try {
    const quote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    return NextResponse.json({
      feeOptions: {
        fee: {
          int: quote.minimumFee,
          float: intToFloat(quote.minimumFee, STELLAR_USDC_DECIMALS),
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch gas fee options" },
      { status: 500 },
    );
  }
}
