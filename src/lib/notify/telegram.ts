/**
 * Outbound-only Telegram alerts.
 *
 * Best-effort operational notifications for the offramp/onramp flows. Posts to
 * the Telegram Bot API; never throws, so a notification failure can't break a
 * payment or bridge path. Configure with:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — the chat/group id to send to
 */

type AlertLevel = "info" | "success" | "warning" | "critical";

const ICON: Record<AlertLevel, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  critical: "🚨",
};

/**
 * Send a Telegram message. Returns true if delivered, false otherwise.
 * Silently no-ops (returns false) when env is unconfigured so local/dev runs
 * don't error.
 */
export async function notify(
  message: string,
  level: AlertLevel = "info",
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Not configured — treat as a no-op rather than an error.
    return false;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${ICON[level]} ${message}`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    return res.ok;
  } catch {
    // Best-effort: never let a notification failure propagate.
    return false;
  }
}

/**
 * Critical alert requiring manual intervention — e.g. onramp fiat settled but
 * the Base→Stellar bridge failed, leaving funds held in the hot wallet.
 */
export async function alertManualAction(details: {
  title: string;
  orderId: string;
  amount?: string;
  currency?: string;
  stellarAddress?: string;
  reason?: string;
}): Promise<boolean> {
  const lines = [
    `<b>MANUAL ACTION NEEDED — ${escapeHtml(details.title)}</b>`,
    `Order: <code>${escapeHtml(details.orderId)}</code>`,
    details.amount &&
      `Amount held: ${escapeHtml(details.amount)} ${escapeHtml(details.currency ?? "")}`.trim(),
    details.stellarAddress &&
      `User Stellar: <code>${escapeHtml(details.stellarAddress)}</code>`,
    details.reason && `Reason: ${escapeHtml(details.reason)}`,
  ].filter(Boolean);

  return notify(lines.join("\n"), "critical");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
