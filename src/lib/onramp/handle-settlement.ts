/**
 * Handles an onramp order reaching `settled` (USDC now in the platform Base hot
 * wallet): bridges Base→Stellar to the user, updating the store as it goes.
 *
 * Failure policy is HOLD-AND-ALERT: if the bridge can't complete, funds stay in
 * the hot wallet, the order is marked `bridge_failed`, and a Telegram alert asks
 * for manual resolution. We never auto-refund or blindly retry.
 */

import {
  getOnrampOrder,
  updateOnrampOrder,
  acquireBridgeLock,
  releaseBridgeLock,
  addPendingBridge,
} from "./onramp-store";
import { bridgeUsdcBaseToStellar, BridgeGasError } from "./base-bridge";
import { notify, alertManualAction } from "@/lib/notify/telegram";
import { recordLedgerEntry } from "@/lib/ledger/funds-ledger";

/**
 * Trigger the bridge for a settled onramp order. Safe to call multiple times
 * (webhook retries): the lock + status checks ensure a single bridge attempt.
 */
export async function handleOnrampSettled(
  orderId: string,
  settledAmount?: string,
  settlementTxHash?: string,
): Promise<void> {
  const record = await getOnrampOrder(orderId);
  if (!record) {
    // No mapping — can't know the user's Stellar address. Alert; funds are held.
    await alertManualAction({
      title: "Onramp settled but order not found in store",
      orderId,
      amount: settledAmount,
      reason: "No Stellar address mapping; cannot auto-bridge.",
    });
    return;
  }

  // Already bridged/handled — nothing to do.
  if (
    record.status === "bridging" ||
    record.status === "delivered" ||
    record.status === "refunded"
  ) {
    return;
  }

  // Single-flight: only one handler proceeds past here per order.
  const gotLock = await acquireBridgeLock(orderId);
  if (!gotLock) return;

  const amount = settledAmount || record.baseUsdcAmount;
  if (!amount) {
    await releaseBridgeLock(orderId);
    await updateOnrampOrder(orderId, {
      status: "bridge_failed",
      failureReason: "Missing settled USDC amount",
    });
    await alertManualAction({
      title: "Onramp bridge blocked — unknown amount",
      orderId,
      stellarAddress: record.userStellarAddress,
      reason: "Settled webhook carried no amount and none was stored.",
    });
    return;
  }

  await recordLedgerEntry({
    direction: "onramp",
    wallet: "base_hot_wallet",
    chain: "base",
    asset: "USDC",
    amount,
    txHash: settlementTxHash || "unknown",
    orderId,
  });

  try {
    await updateOnrampOrder(orderId, {
      status: "bridging",
      baseUsdcAmount: amount,
    });

    const result = await bridgeUsdcBaseToStellar({
      amount,
      stellarAddress: record.userStellarAddress,
    });

    await updateOnrampOrder(orderId, {
      status: "bridging",
      bridgeTxHash: result.bridgeTxHash,
      bridgeStartedAt: Date.now(),
    });

    // Hand off to the finalizer cron, which watches the Allbridge transfer and
    // flips the order to `delivered` once it confirms on Stellar.
    await addPendingBridge(orderId);

    await notify(
      `Onramp <code>${orderId}</code> bridging ${amount} USDC → Stellar (tx ${result.bridgeTxHash})`,
      "success",
    );
    // Note: final `delivered` is set by the finalizer cron once the Allbridge
    // transfer confirms on Stellar, not here.
  } catch (err: any) {
    const reason =
      err instanceof BridgeGasError
        ? `Hot wallet out of gas: ${err.message}`
        : err?.message || "Unknown bridge error";

    await updateOnrampOrder(orderId, {
      status: "bridge_failed",
      failureReason: reason,
    });

    await alertManualAction({
      title:
        err instanceof BridgeGasError
          ? "Onramp bridge failed — hot wallet gas"
          : "Onramp bridge failed",
      orderId,
      amount,
      currency: "USDC",
      stellarAddress: record.userStellarAddress,
      reason,
    });
  } finally {
    await releaseBridgeLock(orderId);
  }
}
