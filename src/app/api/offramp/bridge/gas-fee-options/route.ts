import { NextRequest, NextResponse } from "next/server";
import { getBurnFeeQuote, computeAtomicFee } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, STELLAR_USDC_DECIMALS } from "@/lib/cctp/constants";
import { usdcFloatToStellarInt } from "@/lib/cctp/stellar-cctp";

function intToFloat(amountInt: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = amountInt / divisor;
  const fracDigits = (amountInt % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

export async function GET(request: NextRequest) {
  try {
    const amountParam = request.nextUrl.searchParams.get("amount");
    const quote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    // The fee is a bps rate of the burn amount, not a flat charge — with no
    // amount given (e.g. the pre-form-fill preview fetch) there's nothing to
    // apply it to, so report zero rather than a meaningless atomic value.
    const amountAtomic =
      amountParam && parseFloat(amountParam) > 0
        ? usdcFloatToStellarInt(amountParam)
        : BigInt(0);
    const feeAtomic = computeAtomicFee(quote.minimumFeeBps, amountAtomic);
    return NextResponse.json({
      feeOptions: {
        fee: {
          int: feeAtomic.toString(),
          float: intToFloat(feeAtomic, STELLAR_USDC_DECIMALS),
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
