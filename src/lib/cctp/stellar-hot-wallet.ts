/**
 * New server-signing Stellar wallet, used only to submit `mint_and_forward` on
 * the CCTP Forwarder for the onramp Base→Stellar leg. Pays XLM gas only —
 * mint_and_forward is atomic (mints then forwards in one Soroban invocation),
 * so this wallet never custodies bridged USDC even momentarily.
 *
 * Env:
 *   CCTP_STELLAR_HOT_WALLET_SECRET — Stellar secret key (S...), server secret
 *   CCTP_STELLAR_MIN_GAS_XLM       — optional XLM floor (default 2)
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { CCTP_CONFIG } from "./constants";

export class CctpGasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpGasError";
  }
}

export function getCctpStellarAccount(): StellarSdk.Keypair {
  const secret = process.env.CCTP_STELLAR_HOT_WALLET_SECRET;
  if (!secret) {
    throw new Error("CCTP_STELLAR_HOT_WALLET_SECRET not configured");
  }
  return StellarSdk.Keypair.fromSecret(secret);
}

/** Refuses (throws) rather than risk broadcasting a tx the wallet can't afford. */
export async function assertStellarGasFloor(): Promise<void> {
  const account = getCctpStellarAccount();
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const onchainAccount = await server.getAccount(account.publicKey());
  const horizonBaseUrl = CCTP_CONFIG.stellarRpcUrl.includes("testnet")
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org";
  const horizonBalance = await fetch(
    `${horizonBaseUrl}/accounts/${account.publicKey()}`,
  ).then((r) => r.json());
  const nativeBalance = horizonBalance?.balances?.find(
    (b: any) => b.asset_type === "native",
  );
  const xlmBalance = parseFloat(nativeBalance?.balance ?? "0");
  const floor = parseFloat(process.env.CCTP_STELLAR_MIN_GAS_XLM || "2");
  if (xlmBalance < floor) {
    throw new CctpGasError(
      `CCTP Stellar hot wallet XLM balance ${xlmBalance} below floor ${floor}; refusing to submit`,
    );
  }
  // onchainAccount is fetched to fail fast if the account doesn't exist/isn't funded yet.
  void onchainAccount;
}
