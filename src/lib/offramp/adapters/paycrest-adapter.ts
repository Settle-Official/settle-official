// Paycrest Payout Provider Implementation

import type { PayoutProviderAdapter } from "./payout-provider";
import type {
  PayoutOrderRequest,
  PayoutOrderResponse,
  PayoutStatus,
} from "../types";

const PAYCREST_API_BASE = "https://api.paycrest.io/v1";

export class PaycrestAdapter implements PayoutProviderAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${PAYCREST_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "API-Key": this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Paycrest API error: ${response.statusText}`
      );
    }

    const data = await response.json();
    return data.data || data;
  }

  async getCurrencies(): Promise<
    Array<{
      code: string;
      name: string;
      symbol: string;
    }>
  > {
    return this.fetch("/currencies");
  }

  async getInstitutions(currency: string): Promise<
    Array<{
      code: string;
      name: string;
    }>
  > {
    return this.fetch(`/institutions/${currency}`);
  }

  async verifyAccount(
    institution: string,
    accountIdentifier: string
  ): Promise<string> {
    const result = await this.fetch<{ accountName?: string; data?: string }>(
      "/verify-account",
      {
        method: "POST",
        body: JSON.stringify({
          institution,
          accountIdentifier,
        }),
      }
    );
    return result.accountName || result.data || "";
  }

  async getRate(
    token: string,
    amount: string,
    currency: string,
    options?: {
      network?: string;
      providerId?: string;
    }
  ): Promise<number> {
    const query = new URLSearchParams();
    if (options?.network) {
      query.set("network", options.network);
    }
    if (options?.providerId) {
      query.set("provider_id", options.providerId);
    }

    const endpoint = `/rates/${encodeURIComponent(token)}/${encodeURIComponent(
      amount
    )}/${encodeURIComponent(currency)}${query.toString() ? `?${query.toString()}` : ""}`;

    // Paycrest returns "data" as a numeric string in many cases
    const result = await this.fetch<string | number>(endpoint);
    const parsedRate =
      typeof result === "number" ? result : Number.parseFloat(result);

    if (!Number.isFinite(parsedRate)) {
      throw new Error("Invalid rate response from Paycrest");
    }

    return parsedRate;
  }

  async createOrder(
    request: PayoutOrderRequest
  ): Promise<PayoutOrderResponse> {
    return this.fetch("/sender/orders", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getOrderStatus(orderId: string): Promise<{
    status: PayoutStatus;
    id: string;
  }> {
    return this.fetch(`/sender/orders/${orderId}`);
  }
}

// Helper function to map Paycrest webhook status to our PayoutStatus
export function mapPaycrestStatus(webhookStatus: string): PayoutStatus {
  switch (webhookStatus) {
    case "payment_order.pending":
      return "pending";
    case "payment_order.validated":
      return "validated";
    case "payment_order.settled":
      return "settled";
    case "payment_order.refunded":
      return "refunded";
    case "payment_order.expired":
      return "expired";
    default:
      return "pending";
  }
}
