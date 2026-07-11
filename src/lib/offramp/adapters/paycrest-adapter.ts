// Paycrest Payout Provider Implementation

import type { PayoutProviderAdapter } from "./payout-provider";
import type {
  PayoutOrderRequest,
  PayoutOrderResponse,
  PayoutStatus,
} from "../types";

const PAYCREST_API_BASE = "https://api.paycrest.io/v1";

class PaycrestHttpError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "PaycrestHttpError";
    this.status = status;
    this.details = details;
  }
}

export class PaycrestAdapter implements PayoutProviderAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${PAYCREST_API_BASE}${endpoint}`;
    
    // Abort after 15 seconds to avoid hanging on network issues
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "API-Key": this.apiKey,
          ...options.headers,
        },
      });
    } catch (fetchErr: any) {
      clearTimeout(timer);
      if (fetchErr?.name === "AbortError") {
        throw new PaycrestHttpError(
          `Paycrest API request timed out (15s): ${endpoint}`,
          504,
        );
      }
      throw new PaycrestHttpError(
        `Paycrest API network error: ${fetchErr.message}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
            const message =
        error?.message ||
        error?.error ||
        `Paycrest API error: ${response.status} ${response.statusText}`;
      throw new PaycrestHttpError(message, response.status, error);
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
    accountIdentifier: string,
  ): Promise<string> {
    const result = await this.fetch<{ accountName?: string; data?: string }>(
      "/verify-account",
      {
        method: "POST",
        body: JSON.stringify({
          institution,
          accountIdentifier,
        }),
      },
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
    },
  ): Promise<number> {
    const query = new URLSearchParams();
    if (options?.network) {
      query.set("network", options.network);
    }
    if (options?.providerId) {
      query.set("provider_id", options.providerId);
    }

    const endpoint = `/rates/${encodeURIComponent(token)}/${encodeURIComponent(
      amount,
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

  async createOrder(request: PayoutOrderRequest): Promise<PayoutOrderResponse> {
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

// Helper function to map Paycrest webhook event names to our PayoutStatus.
// Prefer the bare `data.status` from the v2 payload; use this only as a
// fallback when a status field is absent.
export function mapPaycrestStatus(webhookStatus: string): PayoutStatus {
  switch (webhookStatus) {
    case "payment_order.pending":
      return "pending";
    case "payment_order.deposited":
      return "deposited";
    case "payment_order.validated":
      return "validated";
    case "payment_order.settling":
      return "settling";
    case "payment_order.settled":
      return "settled";
    case "payment_order.refunding":
      return "refunding";
    case "payment_order.refunded":
      return "refunded";
    case "payment_order.expired":
      return "expired";
    default:
      return "unknown";
  }
}
