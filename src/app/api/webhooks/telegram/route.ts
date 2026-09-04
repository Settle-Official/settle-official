import { NextRequest, NextResponse } from "next/server";
import { retryOnrampBridge } from "@/lib/onramp/retry-bridge";
import { checkOnrampStatus } from "@/lib/onramp/check-status";
import { reviveStuckTransfer } from "@/lib/cctp/revive";
import { notify, answerCallbackQuery } from "@/lib/notify/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Inbound Telegram commands + button taps:
 *   - `/retry <orderId> [amount]` — re-trigger a stuck onramp bridge. Goes
 *     through handleOnrampSettled, i.e. submits a brand new burn — right for
 *     "the bridge attempt never got anywhere" (gas error, missing amount,
 *     etc), wrong for a transfer that already burned and just needs its mint
 *     step resumed. Use `/revive` for that case instead.
 *   - `/revive <transferId> [orderId]` — recover a CCTP transfer wrongly
 *     frozen `failed` (e.g. it exhausted its retry budget against a missing
 *     secret/gas balance, not a real on-chain failure). Resumes from
 *     wherever it already got to — never re-burns. Pass `orderId` (from the
 *     order's own alert) for onramp so the owning order gets un-stuck too;
 *     find `transferId` via the CctpTransferRecord id (its own alert if one
 *     was sent, or the order's `cctpTransferId` field).
 *   - "Check status" inline button (callback_data `status:<orderId>`) on
 *     every onramp alert — re-checks the bridge on the spot instead of
 *     waiting on the once-daily cron or an open SSE tab.
 *
 * Register once (replace TOKEN/deployment/secret):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<deployment>/api/webhooks/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 * Auth: Telegram echoes secret_token back as
 * X-Telegram-Bot-Api-Secret-Token on every delivery, and only messages/taps
 * from the configured TELEGRAM_CHAT_ID are honored. Everything else is
 * silently ack'd (200) rather than rejected, so Telegram doesn't retry-storm
 * us and random senders don't learn anything from the response.
 */
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = request.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      return NextResponse.json({ ok: true });
    }
  }

  const update = await request.json().catch(() => null);
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;

  const callback = update?.callback_query;
  if (callback) {
    const chatId = callback?.message?.chat?.id;
    if (
      chatId !== undefined &&
      (!allowedChatId || String(chatId) === String(allowedChatId))
    ) {
      const data: string | undefined = callback?.data;
      const match = data?.match(/^status:(\S+)$/);
      if (match) {
        const [, orderId] = match;
        const result = await checkOnrampStatus(orderId);
        if (result.alreadyAlerted) {
          await answerCallbackQuery(callback.id, result.message);
        } else {
          void notify(result.message, result.level);
          await answerCallbackQuery(callback.id, "Checked ✓");
        }
      } else {
        await answerCallbackQuery(callback.id);
      }
    } else {
      await answerCallbackQuery(callback.id);
    }
    return NextResponse.json({ ok: true });
  }

  const message = update?.message;
  const text: string | undefined = message?.text;
  const chatId = message?.chat?.id;

  if (!text || chatId === undefined) {
    return NextResponse.json({ ok: true });
  }

  if (allowedChatId && String(chatId) !== String(allowedChatId)) {
    return NextResponse.json({ ok: true });
  }

  const reviveMatch = text.trim().match(/^\/revive\s+(\S+)(?:\s+(\S+))?/i);
  if (reviveMatch) {
    const [, transferId, orderId] = reviveMatch;
    const result = await reviveStuckTransfer(transferId, orderId);
    await notify(
      `Revive <code>${transferId}</code>: ${result.message}`,
      result.ok ? "success" : "warning",
    );
    return NextResponse.json({ ok: true });
  }

  const match = text.trim().match(/^\/retry\s+(\S+)(?:\s+([\d.]+))?/i);
  if (!match) {
    return NextResponse.json({ ok: true });
  }

  const [, orderId, amount] = match;
  const result = await retryOnrampBridge(orderId, amount);
  await notify(
    `Retry <code>${orderId}</code>: ${result.message}`,
    result.ok ? "success" : "warning",
  );

  return NextResponse.json({ ok: true });
}
