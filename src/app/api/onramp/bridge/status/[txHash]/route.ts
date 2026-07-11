import { NextRequest, NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTransferStatus,
} from "@/lib/offramp/adapters/allbridge-adapter";

export const maxDuration = 30;

/**
 * Poll the Allbridge transfer status for the Base→Stellar onramp leg.
 * chainSymbol is the SOURCE chain — "BAS" for this direction.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ txHash: string }> },
) {
  try {
    const { txHash } = await params;
    const sdk = await initializeAllbridgeSdk();
    const status = await getAllbridgeTransferStatus(sdk, "BAS", txHash);
    return NextResponse.json({ data: status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch bridge status" },
      { status: 500 },
    );
  }
}
