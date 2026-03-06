import { NextRequest, NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTransferStatus,
} from "@/lib/offramp/adapters/allbridge-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ txHash: string }> }
) {
  try {
    const { txHash } = await params;

    if (!txHash) {
      return NextResponse.json(
        { error: "Transaction hash required" },
        { status: 400 }
      );
    }

    // Initialize Allbridge SDK
    const sdk = await initializeAllbridgeSdk();

    // Get transfer status (SRB is Stellar chain symbol in Allbridge)
    const status = await getAllbridgeTransferStatus(sdk, "SRB", txHash);

    return NextResponse.json({ data: status });
  } catch (error: any) {
    console.error("Bridge status error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get bridge status" },
      { status: 500 }
    );
  }
}
