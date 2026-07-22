import { NextRequest, NextResponse } from "next/server";
import { getNextTransferStatus } from "@/lib/offramp/adapters/allbridge-next-adapter";

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

  // getNextTransferStatus never throws — it resolves to "pending" on any
  // lookup failure, since this polling is best-effort and doesn't gate
  // completion (Paycrest's own payout detection is the real success signal).
  const status = await getNextTransferStatus(txHash);
  return NextResponse.json({ data: status });
}
