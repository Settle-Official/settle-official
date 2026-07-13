import { NextRequest, NextResponse } from "next/server";
import { retryOnrampBridge } from "@/lib/onramp/retry-bridge";
import { notify } from "@/lib/notify/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Inbound Telegram commands. Currently just `/retry <orderId> [amount]`, so a
 * stuck onramp bridge can be re-triggered from the same chat that receives
 * the alerts, without a dedicated admin app.
 *
 * Register once (replace TOKEN/deployment/secret):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<deployment>/api/webhooks/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 * Auth: Telegram echoes secret_token back as
 * X-Telegram-Bot-Api-Secret-Token on every delivery, and only messages from
 * the configured TELEGRAM_CHAT_ID are honored. Everything else is silently
 * ack'd (200) rather than rejected, so Telegram doesn't retry-storm us and
 * random senders don't learn anything from the response.
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
  const message = update?.message;
  const text: string | undefined = message?.text;
  const chatId = message?.chat?.id;

  if (!text || chatId === undefined) {
    return NextResponse.json({ ok: true });
  }

  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (allowedChatId && String(chatId) !== String(allowedChatId)) {
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
