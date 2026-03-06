// Payout Provider Adapter Interface

import type {
  BeneficiaryInfo,
  PayoutOrderRequest,
  PayoutOrderResponse,
  PayoutStatus,
} from "../types";

export interface PayoutProviderAdapter {
  /**
   * Get list of supported currencies
   */
  getCurrencies(): Promise<Array<{
    code: string;
    name: string;
    symbol: string;
  }>>;

  /**
   * Get list of institutions for a currency
   */
  getInstitutions(currency: string): Promise<Array<{
    code: string;
    name: string;
  }>>;

  /**
   * Verify beneficiary account
   */
  verifyAccount(
    institution: string,
    accountIdentifier: string
  ): Promise<string>;

  /**
   * Get exchange rate
   */
  getRate(
    token: string,
    amount: string,
    currency: string,
    options?: {
      network?: string;
      providerId?: string;
    }
  ): Promise<number>;

  /**
   * Create payout order
   */
  createOrder(request: PayoutOrderRequest): Promise<PayoutOrderResponse>;

  /**
   * Get order status
   */
  getOrderStatus(orderId: string): Promise<{
    status: PayoutStatus;
    id: string;
  }>;
}
