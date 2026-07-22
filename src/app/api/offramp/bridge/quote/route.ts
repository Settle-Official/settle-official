import { NextRequest, NextResponse } from "next/server";
import {
  getNextQuote,
  intToFloat,
  BASE_USDC_DECIMALS,
} from "@/lib/offramp/adapters/allbridge-next-adapter";
import { validateAmount } from "@/lib/offramp/utils/validation";

/**
 * Raw Stellar->Base USDC bridge receive amount (no Paycrest/fiat conversion —
 * see /api/offramp/quote for the fiat-facing quote). Used at execution time
 * to size the Paycrest payout order to what will actually arrive on Base.
 *
 * This must go through a server route rather than being called directly from
 * the browser: api.next.allbridge.io's CORS policy only allows requests from
 * https://next.allbridge.io, so a direct client-side fetch would be blocked.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const quote = await getNextQuote(amount);
    const receiveAmount = intToFloat(quote.amountOut, BASE_USDC_DECIMALS);

    return NextResponse.json({ receiveAmount });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch bridge quote" },
      { status: 500 },
    );
  }
}
