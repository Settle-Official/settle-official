import { NextRequest, NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTokens,
} from "@/lib/offramp/adapters/allbridge-adapter";
import {
  buildSwapAndBridgeTx,
  getAllbridgeGasFeeOptions,
  getBridgeFeeForMethod,
} from "@/lib/offramp/adapters/soroban-tx-builder";
import {
  validateAmount,
  validateAddress,
} from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress, feePaymentMethod } = body;

    console.log("[build-tx] Request received:", {
      amount,
      fromAddress,
      toAddress,
      feePaymentMethod: feePaymentMethod || "stablecoin (default)",
    });

    // Validation
    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json(
        { error: "Invalid Stellar address" },
        { status: 400 },
      );
    }

    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json(
        { error: "Invalid Base address" },
        { status: 400 },
      );
    }

    console.log("[build-tx] Validation passed, initializing Allbridge SDK...");

    // Use Allbridge SDK only for metadata & fee calculation
    const sdk = await initializeAllbridgeSdk();
    const tokens = await getAllbridgeTokens(sdk);

    if (!tokens.stellar.usdc || !tokens.base.usdc) {
      throw new Error("USDC tokens not found on Allbridge");
    }

    const stellarUsdc = tokens.stellar.usdc;
    const baseUsdc = tokens.base.usdc;

    console.log("[build-tx] Tokens found:", {
      stellarUSDC: stellarUsdc.symbol,
      baseUSDC: baseUsdc.symbol,
      bridgeAddress: stellarUsdc.bridgeAddress,
      stellarTokenAddress: stellarUsdc.tokenAddress,
      baseTokenAddress: baseUsdc.tokenAddress,
      destinationChainId: baseUsdc.allbridgeChainId,
    });

    // Get fee options and select based on user preference
    const feeOptions = await getAllbridgeGasFeeOptions(
      sdk,
      stellarUsdc,
      baseUsdc,
    );
    const selectedMethod: "native" | "stablecoin" =
      feePaymentMethod === "native" ? "native" : "stablecoin";
    const feeInfo = getBridgeFeeForMethod(feeOptions, selectedMethod);
    console.log("[build-tx] Fee method:", selectedMethod, "Fee info:", feeInfo);

    // Build the Soroban transaction using the project's up-to-date stellar-sdk
    // (instead of the Allbridge SDK's bundled stellar-sdk@13.3.0 which only
    //  supports Protocol 21 – the network is now on Protocol 25).
    const xdr = await buildSwapAndBridgeTx({
      bridgeContractId: stellarUsdc.bridgeAddress,
      fromAddress,
      toAddress,
      sourceTokenAddress: stellarUsdc.tokenAddress,
      sourceTokenDecimals: stellarUsdc.decimals,
      destinationTokenAddress: baseUsdc.tokenAddress,
      destinationChainId: baseUsdc.allbridgeChainId,
      amount,
      gasAmount: feeInfo.gasAmount,
      feeTokenAmount: feeInfo.feeTokenAmount,
    });

    if (!xdr || typeof xdr !== "string") {
      throw new Error("Transaction builder returned empty or non-string XDR");
    }

    console.log(
      "[build-tx] Transaction built successfully, XDR length:",
      xdr.length,
    );

    return NextResponse.json({
      xdr,
      sourceToken: stellarUsdc.symbol,
      destinationToken: baseUsdc.symbol,
    });
  } catch (error: any) {
    console.error("[build-tx] Error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      {
        error: error.message || "Failed to build transaction",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
