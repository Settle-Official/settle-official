import { NextRequest, NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTransferStatus,
} from "@/lib/offramp/adapters/allbridge-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ txHash: string }> },
) {
  const { txHash } = await params;

  if (!txHash) {
    return NextResponse.json(
      { error: "Transaction hash required" },
      { status: 400 },
    );
  }

  try {
    // Initialize Allbridge SDK
    const sdk = await initializeAllbridgeSdk();

    // Get transfer status (SRB is Stellar chain symbol in Allbridge)
    const status = await getAllbridgeTransferStatus(sdk, "SRB", txHash);

    return NextResponse.json({ data: status });
  } catch (error: any) {
    // Allbridge may return 404 early on before indexing the cross-chain transfer.
    // Return a pending status instead of failing so the client can keep polling.
    const is404 =
      error?.response?.status === 404 ||
      error?.status === 404 ||
      error?.message?.includes("404");

    if (is404) {
      console.warn(`Bridge status 404 for tx ${txHash} — returning pending`);
      return NextResponse.json({
        data: { status: "pending", txHash },
      });
    }

    console.error("Bridge status error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get bridge status" },
      { status: 500 },
    );
  }
}
