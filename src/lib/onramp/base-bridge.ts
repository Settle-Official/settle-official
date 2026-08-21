/**
 * Onramp Base→Stellar bridge leg, now via direct CCTP instead of Allbridge
 * Core. After Paycrest settles an onramp order, USDC lands in the platform
 * Base hot wallet; this burns it via CCTP's depositForBurnWithHook, routed
 * through Stellar's CctpForwarder so it lands on the real user's G-address.
 * The mint-and-forward completion on Stellar is driven separately by
 * src/lib/cctp/advance.ts (called from the SSE stream / daily cron), not
 * from here — this function's job ends once the Base burn is confirmed.
 */

import { submitBaseBurnWithHook, CctpBaseGasError } from "@/lib/cctp/base-cctp";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN } from "@/lib/cctp/constants";
import { createCctpTransfer } from "@/lib/cctp/cctp-store";
import { randomUUID } from "crypto";

export { CctpBaseGasError as BridgeGasError };

export interface BridgeToStellarResult {
  bridgeTxHash: string;
  sentAmount: string;
  cctpTransferId: string;
}

export async function bridgeUsdcBaseToStellar(params: {
  amount: string; // human USDC amount, e.g. "50.00"
  stellarAddress: string;
}): Promise<BridgeToStellarResult> {
  const feeQuote = await getBurnFeeQuote({
    sourceDomain: CCTP_DOMAIN.base,
    destDomain: CCTP_DOMAIN.stellar,
  });

  const bridgeTxHash = await submitBaseBurnWithHook({
    amountFloat: params.amount,
    forwardRecipientStrkey: params.stellarAddress,
    maxFeeBaseInt: BigInt(feeQuote.minimumFee),
  });

  const cctpTransferId = randomUUID();
  await createCctpTransfer({
    id: cctpTransferId,
    direction: "onramp",
    sourceDomain: CCTP_DOMAIN.base,
    destDomain: CCTP_DOMAIN.stellar,
    burnTxHash: bridgeTxHash,
    mintRecipient: params.stellarAddress,
    status: "burned",
  });

  return { bridgeTxHash, sentAmount: params.amount, cctpTransferId };
}
