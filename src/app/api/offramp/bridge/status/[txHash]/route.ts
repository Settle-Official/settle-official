import { NextRequest, NextResponse } from "next/server";
import { getCctpTransfer } from "@/lib/cctp/cctp-store";

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

  // CctpTransferRecord.id is the burn tx hash itself (see register-transfer),
  // so this is a direct lookup. Best-effort, same as the Allbridge-era
  // version it replaces — doesn't gate completion (Paycrest's own payout
  // detection is the real success signal); an unknown/not-yet-registered
  // hash just reports "pending" rather than erroring.
  const record = await getCctpTransfer(txHash);
  const status =
    !record
      ? "pending"
      : record.status === "completed"
        ? "completed"
        : record.status === "failed"
          ? "failed"
          : "pending";

  return NextResponse.json({ data: { status, txHash } });
}
