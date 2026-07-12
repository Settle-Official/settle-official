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

/**
 * Rich per-transaction offramp alert. Sent at order creation (status "created")
 * and on every webhook status change, so you get one message per event with the
 * full picture: bank details, amount, rate, payout value, and status.
 */
export async function alertOfframpEvent(details: {
  orderId: string;
  status: string; // e.g. "created", "pending", "settled", "refunded"
  accountName?: string;
  accountNumber?: string;
  bank?: string;
  currency?: string;
  amountUsdc?: number | string;
  rate?: number | string;
  payoutValue?: number | string;
  reference?: string;
}): Promise<boolean> {
  const s = (details.status || "unknown").toLowerCase();
  const level: AlertLevel =
    s === "settled"
      ? "success"
      : s === "refunded" || s === "expired"
        ? "warning"
        : "info";

  const cur = details.currency ? ` ${escapeHtml(details.currency)}` : "";
  const fmt = (v?: number | string) =>
    v === undefined || v === null ? "—" : escapeHtml(String(v));

  const lines = [
    `<b>OFFRAMP · ${escapeHtml(s.toUpperCase())}</b>`,
    `Order: <code>${escapeHtml(details.orderId)}</code>`,
    details.accountName && `Name: ${escapeHtml(details.accountName)}`,
    details.accountNumber &&
      `Account: <code>${escapeHtml(details.accountNumber)}</code>` +
        (details.bank ? ` (${escapeHtml(details.bank)})` : ""),
    details.amountUsdc !== undefined &&
      `Amount: ${fmt(details.amountUsdc)} USDC`,
    details.rate !== undefined && `Rate: ${fmt(details.rate)}`,
    details.payoutValue !== undefined &&
      `Payout: ${fmt(details.payoutValue)}${cur}`,
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean);

  return notify(lines.join("\n"), level);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
