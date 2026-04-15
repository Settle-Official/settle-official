import { NextResponse } from "next/server";
import {
  initializeAllbridgeSdk,
  getAllbridgeTokens,
} from "@/lib/offramp/adapters/allbridge-adapter";
import { getAllbridgeGasFeeOptions } from "@/lib/offramp/adapters/soroban-tx-builder";

export async function GET() {
  try {
    const sdk = await initializeAllbridgeSdk();
    const tokens = await getAllbridgeTokens(sdk);

    if (!tokens?.stellar?.usdc || !tokens?.base?.usdc) {
      return NextResponse.json(
        { error: "USDC tokens not found on Allbridge" },
        { status: 500 },
      );
    }

    const feeOptions = await getAllbridgeGasFeeOptions(
      sdk,
      tokens.stellar.usdc,
      tokens.base.usdc,
    );

    return NextResponse.json({ feeOptions });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch gas fee options" },
      { status: 500 },
    );
  }
}
