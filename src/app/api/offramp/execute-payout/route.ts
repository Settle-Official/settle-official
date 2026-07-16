import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// CRITICAL: This endpoint handles server-side token transfer
// Private key is NEVER exposed to the client

const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      bridgeTransferId,
      amount,
      token,
      rate,
      beneficiary,
    } = body;

    // Validation
    if (!bridgeTransferId || !amount || !token || !rate || !beneficiary) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get environment variables (server-side only)
    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    const basePrivateKey = process.env.BASE_PRIVATE_KEY;
    const baseReturnAddress = process.env.BASE_RETURN_ADDRESS;

    if (!paycrestApiKey || !basePrivateKey || !baseReturnAddress) {
      throw new Error("Server configuration incomplete");
    }

    // Step 1: Create Paycrest order
    const paycrest = new PaycrestAdapter(paycrestApiKey);

    const orderData = {
      amount: parseFloat(amount),
      token: token.toUpperCase(),
      network: "base",
      rate: parseFloat(rate),
      recipient: {
        institution: beneficiary.institution,
        accountIdentifier: beneficiary.accountIdentifier,
        accountName: beneficiary.accountName,
        currency: beneficiary.currency,
        memo: beneficiary.memo || "Settu offramp",
      },
      returnAddress: baseReturnAddress,
    };

    const paycrestOrder = await paycrest.createOrder(orderData);

    // Step 2: Transfer tokens to Paycrest receive address (SERVER-SIDE ONLY)

    const publicClient = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });

    const account = privateKeyToAccount(basePrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });

    // Calculate total amount to send (amount + fees)
    const totalAmount =
      parseFloat(paycrestOrder.amount) +
      parseFloat(paycrestOrder.senderFee) +
      parseFloat(paycrestOrder.transactionFee);

    const parsedAmount = parseUnits(totalAmount.toFixed(6), 6); // USDC has 6 decimals

    // ERC20 transfer ABI
    const transferAbi = [
      {
        name: "transfer",
        type: "function",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
      },
    ] as const;

    // Execute transfer
    const hash = await walletClient.writeContract({
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: transferAbi,
      functionName: "transfer",
      args: [paycrestOrder.receiveAddress as `0x${string}`, parsedAmount],
    });


    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      throw new Error("Token transfer failed");
    }

    return NextResponse.json({
      success: true,
      payoutOrderId: paycrestOrder.id,
      destinationTxHash: hash,
      receiveAddress: paycrestOrder.receiveAddress,
      status: paycrestOrder.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to execute payout" },
      { status: 500 }
    );
  }
}
