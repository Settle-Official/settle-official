import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import { createOnrampOrder } from "@/lib/onramp/onramp-store";
import { validateAddress, validateAmount } from "@/lib/offramp/utils/validation";
import { alertRampEvent } from "@/lib/notify/telegram";

/**
 * Create an onramp order.
 *
 * The user pays fiat into the returned virtual account. Paycrest delivers USDC
 * to the PLATFORM Base hot wallet (not the user — Paycrest has no Stellar
 * support). On the `settled` webhook the server bridges Base→Stellar to the
 * user's address, which is persisted here keyed by order id.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.PAYCREST_API_KEY;
    if (!apiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }

    const hotWallet = process.env.ONRAMP_HOT_WALLET_ADDRESS;
    if (!hotWallet || !validateAddress(hotWallet, "base")) {
      // Config error — don't expose specifics to the client.
      throw new Error("Onramp hot wallet not configured");
    }

    const body = await request.json();

    const fiatAmount = String(body?.fiatAmount ?? "");
    const currency = String(body?.currency ?? "").toUpperCase();
    const userStellarAddress = String(body?.userStellarAddress ?? "").trim();
    const country = body?.country ? String(body.country).trim() : undefined;
    const rate = body?.rate ? Number(body.rate) : undefined;
    const reference = body?.reference ? String(body.reference) : undefined;

    const refundAccount = {
      institution: String(body?.refundAccount?.institution ?? "").trim(),
      accountIdentifier: String(
        body?.refundAccount?.accountIdentifier ?? "",
      ).trim(),
      accountName: String(body?.refundAccount?.accountName ?? "").trim(),
    };

    // Validation
    if (!validateAmount(fiatAmount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!currency) {
      return NextResponse.json({ error: "Missing currency" }, { status: 400 });
    }
    if (!validateAddress(userStellarAddress, "stellar")) {
      return NextResponse.json(
        { error: "Invalid Stellar recipient address" },
        { status: 400 },
      );
    }
    if (
      !refundAccount.institution ||
      !refundAccount.accountIdentifier ||
      !refundAccount.accountName
    ) {
      return NextResponse.json(
        { error: "Refund account details are required" },
        { status: 400 },
      );
    }

    const paycrest = new PaycrestAdapter(apiKey);
    const order = await paycrest.createOnrampOrder({
      fiatAmount,
      currency,
      country,
      recipientAddress: hotWallet, // platform Base hot wallet
      network: "base",
      cryptoCurrency: "USDC",
      refundAccount,
      rate,
      reference,
    });

    // Persist the order → user Stellar address mapping so the webhook can bridge
    // to the right wallet later. Also stash refund-account + rate for alert
    // enrichment (the webhook payload lacks them).
    await createOnrampOrder({
      orderId: order.id,
      userStellarAddress,
      fiatAmount,
      currency,
      status: "pending",
      refundInstitution: refundAccount.institution,
      refundAccountIdentifier: refundAccount.accountIdentifier,
      refundAccountName: refundAccount.accountName,
      ...(rate ? { rate } : {}),
    });

    // Guaranteed per-transaction alert — fires even if webhooks aren't wired up.
    void alertRampEvent({
      direction: "onramp",
      orderId: order.id,
      status: "created",
      accountName: refundAccount.accountName,
      accountNumber: refundAccount.accountIdentifier,
      bank: refundAccount.institution,
      currency,
      amountIn: fiatAmount,
      amountInUnit: currency,
      rate,
      payoutUnit: "USDC",
      stellarAddress: userStellarAddress,
    });

    return NextResponse.json({
      data: {
        id: order.id,
        status: order.status,
        providerAccount: order.providerAccount,
      },
    });
  } catch (error: any) {
    const statusCode =
      typeof error?.status === "number" && error.status >= 400
        ? error.status
        : 500;

    // Paycrest 5xx means their backend/provider is having trouble (e.g. an
    // upstream rail outage on the virtual-account side) rather than anything
    // wrong with this request. Surface a friendly message instead of their
    // raw error, but keep the original in `details` for debugging/support.
    const isUpstreamOutage = statusCode >= 500;
    const userMessage = isUpstreamOutage
      ? "Deposit provisioning is temporarily unavailable. This is an issue on our payment provider's side — please try again in a few minutes."
      : error?.message || "Failed to create onramp order";

    return NextResponse.json(
      {
        error: userMessage,
        details: error?.details ?? null,
      },
      { status: statusCode },
    );
  }
}
