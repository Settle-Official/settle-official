/**
 * Build Allbridge bridge `swap_and_bridge` Soroban transactions using the
 * project's own @stellar/stellar-sdk (v14.x, Protocol 22+) instead of the
 * Allbridge SDK's bundled stellar-sdk@13.3.0 which only supports Protocol 21.
 *
 * The Allbridge SDK is still used for:
 *   – chain / token metadata  (chainDetailsMap)
 *   – fee calculation          (getGasFeeOptions via prepareTxSendParams)
 *   – quotes                   (getAmountToBeReceived)
 *
 * Only the raw Soroban transaction building, simulation, and assembly is done
 * here so the XDR is compatible with the current network protocol.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SOROBAN_RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ||
  "https://soroban-rpc.mainnet.stellar.gateway.fm";

const NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

// The swap_and_bridge function spec extracted from the Allbridge BridgeContract.
// This is stable – the on-chain contract ABI doesn't change between SDK releases.
const SWAP_AND_BRIDGE_SPEC = [
  // swap_and_bridge(sender, token, amount, recipient, destination_chain_id, receive_token, nonce, gas_amount, fee_token_amount) -> Result<void>
  "AAAAAAAAAAAAAAAPc3dhcF9hbmRfYnJpZGdlAAAAAAkAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAoAAAAAAAAACXJlY2lwaWVudAAAAAAAA+4AAAAgAAAAAAAAABRkZXN0aW5hdGlvbl9jaGFpbl9pZAAAAAQAAAAAAAAADXJlY2VpdmVfdG9rZW4AAAAAAAPuAAAAIAAAAAAAAAAFbm9uY2UAAAAAAAAMAAAAAAAAAApnYXNfYW1vdW50AAAAAAAKAAAAAAAAABBmZWVfdG9rZW5fYW1vdW50AAAACgAAAAEAAAPpAAAD7QAAAAAAAAAD",
];

const SEND_TX_TIMEOUT_SEC = 180;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getNonceBigInt(): bigint {
  const value = randomBytes(32).readBigInt64BE();
  return value < BigInt(0) ? -value : value;
}

/**
 * Convert a human-readable float amount to on-chain integer representation.
 * E.g.  "10.5" with decimals=7  → "105000000"
 */
export function floatToInt(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const intPart = parts[0] || "0";
  let fracPart = parts[1] || "";
  fracPart = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const raw =
    BigInt(intPart) * BigInt(10) ** BigInt(decimals) + BigInt(fracPart);
  return raw.toString();
}

/**
 * Build the `swap_and_bridge` contract invocation, simulate it with the
 * latest Soroban RPC, assemble the result, and return the XDR envelope
 * (base64) ready for Freighter to sign.
 */
export async function buildSwapAndBridgeTx(params: {
  bridgeContractId: string;
  fromAddress: string;
  toAddress: string;
  sourceTokenAddress: string;
  sourceTokenDecimals: number;
  destinationTokenAddress: string;
  destinationChainId: number;
  amount: string;
  gasAmount: string; // native XLM fee (stroops) — set to "0" when paying with stablecoin
  feeTokenAmount: string; // source-token fee (int)   — set to "0" when paying with native
}): Promise<string> {
  const {
    bridgeContractId,
    fromAddress,
    toAddress,
    sourceTokenAddress,
    sourceTokenDecimals,
    destinationTokenAddress,
    destinationChainId,
    amount,
    gasAmount,
    feeTokenAmount,
  } = params;

  
  // 1. Connect to Soroban RPC and load source account
  const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
  const sourceAccount = await rpcServer.getAccount(fromAddress);

  // 2. Convert amount to on-chain integer
  const amountInt = BigInt(floatToInt(amount, sourceTokenDecimals));

  // 3. Encode parameters for the contract call
  // sourceTokenAddress is already a C-key (e.g. CCW67...), Address() handles both G/C keys
  const recipientBytes = Buffer.from(toAddress.replace(/^0x/i, ""), "hex");
  // Pad to 32 bytes if it's a 20-byte EVM address
  const recipient32 =
    recipientBytes.length < 32
      ? Buffer.concat([
          Buffer.alloc(32 - recipientBytes.length),
          recipientBytes,
        ])
      : recipientBytes;

  const receiveTokenBytes = Buffer.from(
    destinationTokenAddress.replace(/^0x/i, ""),
    "hex",
  );
  const receiveToken32 =
    receiveTokenBytes.length < 32
      ? Buffer.concat([
          Buffer.alloc(32 - receiveTokenBytes.length),
          receiveTokenBytes,
        ])
      : receiveTokenBytes;

  const nonce = getNonceBigInt();
  const gasAmountInt = BigInt(gasAmount);
  const feeTokenAmountInt = BigInt(feeTokenAmount);

  
  // 4. Build the contract call using the project's SDK contract spec.
  //    funcArgsToScVals handles all type marshaling from the ABI spec –
  //    pass raw Address objects, BigInts, Buffers, and numbers directly.
  const spec = new StellarSdk.contract.Spec(SWAP_AND_BRIDGE_SPEC);
  const invocation = spec.funcArgsToScVals("swap_and_bridge", {
    sender: new StellarSdk.Address(fromAddress),
    token: new StellarSdk.Address(sourceTokenAddress),
    amount: amountInt,
    recipient: recipient32,
    destination_chain_id: destinationChainId,
    receive_token: receiveToken32,
    nonce: nonce,
    gas_amount: gasAmountInt,
    fee_token_amount: feeTokenAmountInt,
  });

  // 5. Create the invoke host function operation
  const contract = new StellarSdk.Contract(bridgeContractId);
  const operation = contract.call("swap_and_bridge", ...invocation);

  // 6. Build the transaction
  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(SEND_TX_TIMEOUT_SEC)
    .build();

  // 7. Simulate the transaction (separate from assembly so we can tweak auth)
    const simResult = await rpcServer.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(
      `Simulation failed: ${(simResult as any).error || JSON.stringify(simResult)}`,
    );
  }

  // Cast to success type
  const simSuccess =
    simResult as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

  // 7b. Extend Soroban auth entry expiration so that the user has time to
  //     review and sign in their wallet without the auth becoming stale.
  //     By default, simulation sets signatureExpirationLedger close to the
  //     current ledger.  We push it out by ~500 ledgers (~40 minutes).
  const AUTH_EXPIRATION_LEDGER_BUMP = 500;
  if (simSuccess.result?.auth) {
    const latestLedger = simSuccess.latestLedger;
    const desiredExpiration = latestLedger + AUTH_EXPIRATION_LEDGER_BUMP;

    for (const authEntry of simSuccess.result.auth) {
      const creds = authEntry.credentials();
      if (creds.switch().name === "sorobanCredentialsAddress") {
        const currentExp = creds.address().signatureExpirationLedger();
                creds.address().signatureExpirationLedger(desiredExpiration);
      }
    }
  }

  // 8. Assemble the transaction with the (possibly extended) auth entries.
  //    We pass a higher fee *before* assembling so the final tx already has
  //    a healthy inclusion margin and we do NOT need to clone afterwards
  //    (cloneFrom strips SorobanTransactionData, breaking the tx).
  const originalFee = parseInt(tx.fee, 10); // fee from initial TransactionBuilder (BASE_FEE)
  const simMinFee = parseInt((simSuccess as any).minResourceFee ?? "0", 10);
  // Target fee = (baseFee + minResourceFee) × 1.5   (~0.01 XLM extra)
  const targetFee = Math.ceil((originalFee + simMinFee) * 1.5);

  // `assembleTransaction` adds minResourceFee on top of whatever fee the tx
  // already carries.  To hit our target we set the pre-assembly fee so that
  // after addition we land on `targetFee`.
  const preAssemblyFee = Math.max(targetFee - simMinFee, originalFee);
  // Mutate the inner tx fee before assembly
  (tx as any)._fee = preAssemblyFee.toString();

  const finalTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();

  
  // 9. Return the base64 XDR envelope (unsigned)
  const xdr = finalTx.toXDR();
    return xdr;
}

/**
 * Fee information returned by getAllbridgeGasFee.
 *
 * The Allbridge `swap_and_bridge` contract accepts two fee parameters:
 *   - `gas_amount`       — paid in native XLM (stroops).  Contract transfers
 *                          this from the sender to the bridge.  Requires the
 *                          user to hold sufficient XLM.
 *   - `fee_token_amount` — paid in the source token (e.g. USDC).  Deducted
 *                          from the bridged amount so no extra XLM is needed.
 *
 * We prefer WITH_STABLECOIN so the user does not need extra XLM on hand.
 */
export interface BridgeFeeInfo {
  /** Native-token fee (stroops) — pass as `gas_amount` */
  gasAmount: string;
  /** Source-token fee (int) — pass as `fee_token_amount` */
  feeTokenAmount: string;
}

export async function getAllbridgeGasFee(
  sdk: any,
  sourceToken: any,
  destinationToken: any,
): Promise<BridgeFeeInfo> {
  const { Messenger, FeePaymentMethod, AmountFormat } =
    await import("@allbridge/bridge-core-sdk");

  const gasFeeOptions = await sdk.getGasFeeOptions(
    sourceToken,
    destinationToken,
    Messenger.ALLBRIDGE,
  );

  
  // Prefer paying with the source stablecoin so the user doesn't need
  // extra XLM beyond the Soroban inclusion fee.
  const stableFee =
    gasFeeOptions?.[FeePaymentMethod.WITH_STABLECOIN]?.[AmountFormat.INT];

  if (stableFee) {
        return { gasAmount: "0", feeTokenAmount: String(stableFee) };
  }

  // Fallback to native XLM payment
  const nativeFee =
    gasFeeOptions?.[FeePaymentMethod.WITH_NATIVE_CURRENCY]?.[AmountFormat.INT];

  if (nativeFee) {
        return { gasAmount: String(nativeFee), feeTokenAmount: "0" };
  }

    return { gasAmount: "0", feeTokenAmount: "0" };
}

/* ------------------------------------------------------------------ */
/*  Fee options for UI display                                         */
/* ------------------------------------------------------------------ */

export interface BridgeFeeOptions {
  native: { int: string; float: string };
  stablecoin: { int: string; float: string };
}

/**
 * Return both fee options (native XLM and stablecoin USDC) so the UI can
 * let the user choose which token to pay the bridge gas fee with.
 */
export async function getAllbridgeGasFeeOptions(
  sdk: any,
  sourceToken: any,
  destinationToken: any,
): Promise<BridgeFeeOptions> {
  const { Messenger, FeePaymentMethod, AmountFormat } =
    await import("@allbridge/bridge-core-sdk");

  const gasFeeOptions = await sdk.getGasFeeOptions(
    sourceToken,
    destinationToken,
    Messenger.ALLBRIDGE,
  );

  
  return {
    native: {
      int: String(
        gasFeeOptions?.[FeePaymentMethod.WITH_NATIVE_CURRENCY]?.[
          AmountFormat.INT
        ] || "0",
      ),
      float: String(
        gasFeeOptions?.[FeePaymentMethod.WITH_NATIVE_CURRENCY]?.[
          AmountFormat.FLOAT
        ] || "0",
      ),
    },
    stablecoin: {
      int: String(
        gasFeeOptions?.[FeePaymentMethod.WITH_STABLECOIN]?.[AmountFormat.INT] ||
          "0",
      ),
      float: String(
        gasFeeOptions?.[FeePaymentMethod.WITH_STABLECOIN]?.[
          AmountFormat.FLOAT
        ] || "0",
      ),
    },
  };
}

/**
 * Given fee options and a user-selected method, return the BridgeFeeInfo
 * to pass into buildSwapAndBridgeTx.
 */
export function getBridgeFeeForMethod(
  feeOptions: BridgeFeeOptions,
  method: "native" | "stablecoin",
): BridgeFeeInfo {
  if (method === "stablecoin") {
    return { gasAmount: "0", feeTokenAmount: feeOptions.stablecoin.int };
  }
  return { gasAmount: feeOptions.native.int, feeTokenAmount: "0" };
}
