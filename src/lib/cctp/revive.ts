/**
 * Manual recovery for a CCTP transfer wrongly frozen `failed` — e.g. it
 * exhausted advance.ts's MAX_ATTEMPTS while a required secret or gas balance
 * was missing, not because of a genuine on-chain failure. Born from a real
 * incident: an onramp burn succeeded and even attested, but the mint step
 * had nowhere to go (CCTP_STELLAR_HOT_WALLET_SECRET wasn't provisioned yet)
 * and kept retrying until it hit the ceiling and got frozen — at that point
 * cctp-store's terminal-record guard (the fix for an earlier race-condition
 * incident) correctly refuses to let normal code move it again, so recovery
 * has to be this explicit.
 *
 * Shared by the admin HTTP endpoint and the Telegram `/revive` command, same
 * pattern as retry-bridge.ts. Judgment call for whoever triggers it: this
 * assumes MAX_ATTEMPTS was exhausted for an operational reason (now fixed),
 * not a genuine, still-present on-chain problem — reviving into the same
 * dead end just burns through the retry budget again.
 */

import {
  getCctpTransfer,
  reviveCctpTransfer,
  type CctpStatus,
} from "./cctp-store";
import { advanceCctpTransfer } from "./advance";
import {
  getOnrampOrder,
  updateOnrampOrder,
  resumeBridgingForRetry,
} from "@/lib/onramp/onramp-store";

const MAX_INLINE_ADVANCES = 6;
const ADVANCE_SPACING_MS = 3000;

export interface ReviveResult {
  ok: boolean;
  message: string;
  status?: CctpStatus;
}

export async function reviveStuckTransfer(
  transferId: string,
  orderId?: string,
): Promise<ReviveResult> {
  const before = await getCctpTransfer(transferId);
  if (!before) {
    return { ok: false, message: `No CCTP transfer for id ${transferId}.` };
  }
  if (before.status !== "failed") {
    return {
      ok: false,
      message: `Transfer ${transferId} is ${before.status}, not failed — nothing to revive.`,
      status: before.status,
    };
  }

  const result = await reviveCctpTransfer(transferId);
  if (!result?.revived) {
    return {
      ok: false,
      message: `Transfer ${transferId} could not be revived.`,
      status: before.status,
    };
  }

  // Best-effort: try to actually finish the job now instead of only
  // resetting state and waiting on the next SSE tick or the daily cron.
  // advanceCctpTransfer is idempotent and lock-protected, so racing an
  // open tab's own tick here is harmless.
  let status: CctpStatus = result.record.status;
  for (let i = 0; i < MAX_INLINE_ADVANCES; i++) {
    if (status === "completed" || status === "failed") break;
    status = await advanceCctpTransfer(transferId);
    if (status === "completed" || status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, ADVANCE_SPACING_MS));
  }

  let orderNote = "";
  if (before.direction === "onramp" && orderId) {
    const order = await getOnrampOrder(orderId);
    if (!order) {
      orderNote = ` (order ${orderId} not found — order left untouched)`;
    } else if (order.cctpTransferId !== transferId) {
      orderNote = ` (order ${orderId} points at a different transfer — order left untouched)`;
    } else if (order.status === "bridge_failed") {
      // Un-gate the order so the SSE stream (which only advances while
      // status is "bridging") can pick up wherever this loop left off.
      await resumeBridgingForRetry(orderId);
      if (status === "completed") {
        const transfer = await getCctpTransfer(transferId);
        await updateOnrampOrder(orderId, {
          status: "delivered",
          stellarTxHash: transfer?.mintTxHash,
        });
        orderNote = `; order ${orderId} delivered`;
      } else if (status === "failed") {
        await updateOnrampOrder(orderId, {
          status: "bridge_failed",
          failureReason: "CCTP transfer failed again after revival",
        });
        orderNote = `; order ${orderId} failed again — see transfer's lastError`;
      } else {
        orderNote = `; order ${orderId} back to bridging, still in flight`;
      }
    }
  }

  return {
    ok: status !== "failed",
    message: `Transfer ${transferId} revived, now ${status}${orderNote}.`,
    status,
  };
}
