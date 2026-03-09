// Allbridge Bridge Provider Implementation

import type { BridgeProviderAdapter } from "./bridge-provider";
import type {
  TokenInfo,
  BridgeTransferRequest,
  BridgeStatus,
} from "../types";

export class AllbridgeAdapter implements BridgeProviderAdapter {
  getAverageTransferTime(
    _sourceToken: TokenInfo,
    _destinationToken: TokenInfo
  ): number {
    // Allbridge typically takes 2-5 minutes
    return 3 * 60 * 1000; // 3 minutes in milliseconds
  }

  async getQuote(_request: BridgeTransferRequest): Promise<{
    receiveAmount: string;
    fee: string;
    estimatedTime: number;
  }> {
    throw new Error("Use server-side functions");
  }

  async buildSendTx(_request: BridgeTransferRequest): Promise<unknown> {
    throw new Error("Use server-side functions");
  }

  async getTransferStatus(_transferId: string): Promise<{
    status: BridgeStatus;
    txHash?: string;
  }> {
    throw new Error("Use server-side functions");
  }
}

// Server-side Allbridge SDK functions
export async function initializeAllbridgeSdk() {
  const { AllbridgeCoreSdk, nodeRpcUrlsDefault } = await import(
    "@allbridge/bridge-core-sdk"
  );

  const legacyRpcUrl = process.env.STELLAR_RPC_URL;
  const legacyOverrides =
    legacyRpcUrl && legacyRpcUrl.includes("horizon")
      ? { STLR: legacyRpcUrl }
      : legacyRpcUrl
        ? { SRB: legacyRpcUrl }
        : {};

  // Important: in Allbridge SDK, SRB is Stellar Soroban RPC and STLR is Horizon.
  // Pointing SRB to Horizon causes 405 (POST /) during rawTxBuilder.send().
  const rpcUrls = {
    ...nodeRpcUrlsDefault,
    // Use a widely available public mainnet Stellar RPC by default.
    SRB: process.env.STELLAR_SOROBAN_RPC_URL || "https://soroban-rpc.mainnet.stellar.gateway.fm",
    STLR: process.env.STELLAR_HORIZON_URL || "https://horizon.stellar.org",
    ...legacyOverrides,
  };

  console.log("Initializing Allbridge SDK with RPC URLs:", {
    SRB: rpcUrls.SRB,
    STLR: rpcUrls.STLR,
  });

  return new AllbridgeCoreSdk(rpcUrls);
}

export async function getAllbridgeChains(sdk: any) {
  return await sdk.chainDetailsMap();
}

export async function getAllbridgeQuote(
  sdk: any,
  sourceToken: any,
  destinationToken: any,
  amount: string
): Promise<{
  receiveAmount: string;
  fee: string;
  estimatedTime: number;
}> {
  const { Messenger } = await import("@allbridge/bridge-core-sdk");

  const amountToBeReceived = await sdk.getAmountToBeReceived(
    amount,
    sourceToken,
    destinationToken
  );

  const fee = (
    parseFloat(amount) - parseFloat(amountToBeReceived)
  ).toString();

  const estimatedTime = sdk.getAverageTransferTime(
    sourceToken,
    destinationToken,
    Messenger.ALLBRIDGE
  );

  return {
    receiveAmount: amountToBeReceived,
    fee,
    estimatedTime,
  };
}

export async function buildAllbridgeSendTx(
  sdk: any,
  params: {
    amount: string;
    fromAddress: string;
    toAddress: string;
    sourceToken: any;
    destinationToken: any;
  }
): Promise<string> {
  const { Messenger } = await import("@allbridge/bridge-core-sdk");

  try {
    console.log("Building Allbridge send transaction with params:", {
      amount: params.amount,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      sourceTokenSymbol: params.sourceToken?.symbol,
      destinationTokenSymbol: params.destinationToken?.symbol,
    });

    // Check if approval is needed (for Stellar, this might not be required)
    // But we'll check anyway to be safe
    try {
      const needsApproval = !(await sdk.bridge.checkAllowance({
        token: params.sourceToken,
        owner: params.fromAddress,
        amount: params.amount,
      }));

      if (needsApproval) {
        console.log("Approval needed for Allbridge transfer");
        // For Stellar, approval might be handled differently or not needed
        // We'll let the transaction build proceed
      }
    } catch (approvalError: any) {
      console.warn("Could not check allowance (might not be needed for Stellar):", approvalError.message);
      // Continue anyway - Stellar might not need approval
    }

    // Build the transaction XDR for Stellar
    const rawTx = await sdk.bridge.rawTxBuilder.send({
      amount: params.amount,
      fromAccountAddress: params.fromAddress,
      toAccountAddress: params.toAddress,
      sourceToken: params.sourceToken,
      destinationToken: params.destinationToken,
      messenger: Messenger.ALLBRIDGE,
    });

    console.log("Successfully built Allbridge transaction, XDR length:", rawTx?.length);

    // For Stellar, rawTx is the XDR string
    return rawTx;
  } catch (error: any) {
    console.error("Error in buildAllbridgeSendTx:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    throw new Error(`Failed to build Allbridge transaction: ${error.message}`);
  }
}

export async function getAllbridgeTransferStatus(
  sdk: any,
  chainSymbol: string,
  txHash: string
): Promise<{
  status: BridgeStatus;
  txHash?: string;
  receiveAmount?: string;
}> {
  try {
    const transferStatus = await sdk.getTransferStatus(chainSymbol, txHash);

    // Map Allbridge status to our BridgeStatus
    let status: BridgeStatus;
    
    // Allbridge statuses: pending, processing, completed, failed
    switch (transferStatus.status?.toLowerCase()) {
      case "completed":
      case "success":
        status = "completed";
        break;
      case "failed":
      case "error":
        status = "failed";
        break;
      case "processing":
      case "in_progress":
        status = "processing";
        break;
      case "pending":
      case "waiting":
        status = "pending";
        break;
      default:
        status = "pending";
    }

    return {
      status,
      txHash: transferStatus.txHash || txHash,
      receiveAmount: transferStatus.receiveAmount,
    };
  } catch (error: any) {
    console.error("Error getting Allbridge transfer status:", error);
    // If we can't get status, assume it's still pending
    return {
      status: "pending",
      txHash,
    };
  }
}

// Helper to get Stellar and Base token info from Allbridge
export async function getAllbridgeTokens(sdk: any) {
  const chains = await sdk.chainDetailsMap();
  
  // Get Stellar chain (SRB)
  const stellarChain = chains["SRB"];
  const stellarUSDC = stellarChain?.tokens.find((t: any) => t.symbol === "USDC");
  
  // Get Base chain (BAS)
  const baseChain = chains["BAS"];
  const baseUSDC = baseChain?.tokens.find((t: any) => t.symbol === "USDC");
  
  return {
    stellar: {
      chain: stellarChain,
      usdc: stellarUSDC,
    },
    base: {
      chain: baseChain,
      usdc: baseUSDC,
    },
  };
}
