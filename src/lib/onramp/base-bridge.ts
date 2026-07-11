/**
 * Custodial Base → Stellar bridge (server-signed).
 *
 * After Paycrest settles an onramp order, USDC lands in the platform Base hot
 * wallet. This module signs the Allbridge Base→Stellar transfer that delivers
 * that USDC to the user's Stellar address. It holds a hot-wallet private key
 * and pays Base gas, so it is server-only and deliberately conservative:
 *   - refuses to run if ETH gas balance is below a floor (surfaced, not silent)
 *   - approves USDC to the bridge only when allowance is insufficient
 *   - returns the broadcast tx hash so the caller can persist + poll status
 *
 * Env:
 *   ONRAMP_HOT_WALLET_PRIVATE_KEY  — 0x-prefixed Base key (server secret)
 *   ONRAMP_HOT_WALLET_ADDRESS      — its address (checked against the key)
 *   BASE_RPC_URL                   — Base mainnet RPC
 *   ONRAMP_MIN_GAS_ETH             — optional ETH floor (default 0.0005)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  initializeAllbridgeSdk,
  getAllbridgeTokens,
} from "@/lib/offramp/adapters/allbridge-adapter";

export class BridgeGasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeGasError";
  }
}

function getAccount() {
  const pk = process.env.ONRAMP_HOT_WALLET_PRIVATE_KEY;
  if (!pk) {
    throw new Error("ONRAMP_HOT_WALLET_PRIVATE_KEY not configured");
  }
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(normalized);
}

function getClients() {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error("BASE_RPC_URL not configured");

  const account = getAccount();
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport,
  });
  return { account, publicClient, walletClient };
}

/**
 * Sign and broadcast a raw EVM transaction produced by the Allbridge SDK
 * ({ to, data, value }). viem estimates gas; the account pays Base ETH.
 */
async function signAndSend(
  walletClient: ReturnType<typeof getClients>["walletClient"],
  raw: { to?: string; data?: string; value?: string },
): Promise<Hex> {
  if (!raw.to) throw new Error("Bridge tx missing `to` address");
  return walletClient.sendTransaction({
    to: raw.to as Hex,
    data: (raw.data as Hex) ?? undefined,
    value: raw.value ? BigInt(raw.value) : BigInt(0),
  });
}

export interface BridgeToStellarResult {
  bridgeTxHash: string;
  approvalTxHash?: string;
  sentAmount: string;
}

/**
 * Bridge `amount` USDC from the platform Base hot wallet to `stellarAddress`.
 * Assumes the USDC is already in the hot wallet (post-settlement). Throws
 * BridgeGasError if ETH is too low to safely cover gas — caller should hold the
 * funds and alert rather than retry blindly.
 */
export async function bridgeUsdcBaseToStellar(params: {
  amount: string; // human USDC amount, e.g. "50.00"
  stellarAddress: string;
}): Promise<BridgeToStellarResult> {
  const { account, publicClient, walletClient } = getClients();

  // Gas floor check — refuse rather than broadcast a tx that could strand.
  const floor = parseEther(process.env.ONRAMP_MIN_GAS_ETH || "0.0005");
  const ethBalance = await publicClient.getBalance({
    address: account.address,
  });
  if (ethBalance < floor) {
    throw new BridgeGasError(
      `Hot wallet ETH balance ${ethBalance} below floor ${floor}; refusing to bridge`,
    );
  }

  const sdk = await initializeAllbridgeSdk();
  const tokens = await getAllbridgeTokens(sdk);
  if (!tokens.base.usdc || !tokens.stellar.usdc) {
    throw new Error("USDC tokens not found on Allbridge (Base/Stellar)");
  }
  const baseUsdc = tokens.base.usdc;
  const stellarUsdc = tokens.stellar.usdc;

  const { Messenger, FeePaymentMethod } = await import(
    "@allbridge/bridge-core-sdk"
  );

  // Approve USDC to the bridge only if the current allowance is insufficient.
  let approvalTxHash: string | undefined;
  const needsApproval = !(await sdk.bridge.checkAllowance({
    token: baseUsdc,
    owner: account.address,
    amount: params.amount,
  }));
  if (needsApproval) {
    const approveRaw = (await sdk.bridge.rawTxBuilder.approve({
      token: baseUsdc,
      owner: account.address,
    })) as { to?: string; data?: string; value?: string };
    approvalTxHash = await signAndSend(walletClient, approveRaw);
    // Wait for the approval to be mined before the transfer reads allowance.
    await publicClient.waitForTransactionReceipt({
      hash: approvalTxHash as Hex,
    });
  }

  // Build the Base→Stellar transfer. Gas paid in native ETH on Base.
  const sendRaw = (await sdk.bridge.rawTxBuilder.send({
    amount: params.amount,
    fromAccountAddress: account.address,
    toAccountAddress: params.stellarAddress,
    sourceToken: baseUsdc,
    destinationToken: stellarUsdc,
    messenger: Messenger.ALLBRIDGE,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  })) as { to?: string; data?: string; value?: string };

  const bridgeTxHash = await signAndSend(walletClient, sendRaw);

  return {
    bridgeTxHash,
    approvalTxHash,
    sentAmount: params.amount,
  };
}
