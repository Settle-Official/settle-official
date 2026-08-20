import { NextRequest, NextResponse } from "next/server";
import {
  checkStellarUsdcAllowance,
  buildApproveUsdcTx,
  buildStellarBurnTx,
  usdcFloatToStellarInt,
} from "@/lib/cctp/stellar-cctp";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN } from "@/lib/cctp/constants";
import {
  validateAmount,
  validateAddress,
} from "@/lib/offramp/utils/validation";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
    }
    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json({ error: "Invalid Base address" }, { status: 400 });
    }

    const amountInt = usdcFloatToStellarInt(amount);

    const allowance = await checkStellarUsdcAllowance(fromAddress);
    if (allowance < amountInt) {
      // Approve a generous headroom so repeat offramps skip this step —
      // matches standard "approve once" dApp UX. 1000 USDC in Stellar subunits.
      const approveAmount =
        amountInt > BigInt(10_000_000_000) ? amountInt * BigInt(2) : BigInt(10_000_000_000);
      const approveXdr = await buildApproveUsdcTx({
        owner: fromAddress,
        amount: approveAmount,
      });
      return NextResponse.json({ needsApproval: true, approveXdr });
    }

    const feeQuote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    const maxFeeStellarInt = BigInt(feeQuote.minimumFee);

    const xdr = await buildStellarBurnTx({
      owner: fromAddress,
      amountFloat: amount,
      destinationEvmAddress: toAddress,
      maxFeeStellarInt,
    });

    return NextResponse.json({
      needsApproval: false,
      xdr,
      sourceToken: "USDC",
      destinationToken: "USDC",
    });
  } catch (error: any) {
    let userMessage = error.message || "Failed to build transaction";
    const msg = error.message || "";

    if (msg.includes("resulting balance is not within the allowed range")) {
      userMessage =
        "Insufficient XLM balance for the native gas fee. " +
        "Your remaining XLM would fall below Stellar's minimum account reserve. " +
        "Add more XLM to your wallet.";
    } else if (msg.includes("contract call failed") && msg.includes("transfer")) {
      userMessage =
        "A token transfer in the bridge contract failed during simulation. " +
        "This usually means insufficient balance for the amount + fees.";
    }

    return NextResponse.json(
      {
        error: userMessage,
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
