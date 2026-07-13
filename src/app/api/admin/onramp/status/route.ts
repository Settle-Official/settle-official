import { NextRequest, NextResponse } from "next/server";
import { checkOnrampStatus } from "@/lib/onramp/check-status";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand onramp status check — the HTTP twin of the Telegram "Check
 * status" button, for orders that predate that button or when you'd rather
 * curl than tap. If the order is `bridging`, this actively re-checks
 * Allbridge instead of waiting for the once-daily cron.
 *
 * Auth: `Authorization: Bearer $ADMIN_API_SECRET`. Required in production.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_API_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const orderId = String(body?.orderId ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  const result = await checkOnrampStatus(orderId);
  return NextResponse.json(result);
}
