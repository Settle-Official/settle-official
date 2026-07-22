import { NextResponse } from "next/server";
import { getNextGasFeeOptions } from "@/lib/offramp/adapters/allbridge-next-adapter";

export async function GET() {
  try {
    // Any positive placeholder amount works here — Allbridge Next's relayer
    // fee for this route is a flat gas-cost reimbursement, not a percentage,
    // so it doesn't vary with the amount the user eventually enters.
    const feeOptions = await getNextGasFeeOptions("1");
    return NextResponse.json({ feeOptions });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch gas fee options" },
      { status: 500 },
    );
  }
}
