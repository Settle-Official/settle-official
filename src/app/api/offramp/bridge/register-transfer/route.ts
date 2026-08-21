import { NextRequest, NextResponse } from "next/server";
import { createCctpTransfer } from "@/lib/cctp/cctp-store";
import { recordLedgerEntry } from "@/lib/ledger/funds-ledger";
import { CCTP_DOMAIN } from "@/lib/cctp/constants";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { burnTxHash, mintRecipient, amount, paycrestOrderId } = body;

    if (!burnTxHash || !mintRecipient || !amount) {
      return NextResponse.json(
        { error: "burnTxHash, mintRecipient, and amount are required" },
        { status: 400 },
      );
    }

    // The burn tx hash is already unique per transfer, and the client already
    // has it (it's what pollBridgeStatus/the SSE stream key off) — using it
    // as the record id avoids maintaining a second, separate identifier.
    const record = await createCctpTransfer({
      id: burnTxHash,
      direction: "offramp",
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
      burnTxHash,
      mintRecipient,
      status: "burned",
      paycrestOrderId,
    });

    await recordLedgerEntry({
      direction: "offramp",
      chain: "stellar",
      asset: "USDC",
      amount,
      txHash: burnTxHash,
      orderId: paycrestOrderId,
    });

    return NextResponse.json({ transferId: record.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to register transfer" },
      { status: 500 },
    );
  }
}
