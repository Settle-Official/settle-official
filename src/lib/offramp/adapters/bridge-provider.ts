// Bridge Provider Adapter Interface

import type {
  TokenInfo,
  BridgeTransferRequest,
  BridgeTransferResponse,
  BridgeStatus,
} from "../types";

export interface BridgeProviderAdapter {
  /**
   * Get quote for bridge transfer
   */
  getQuote(request: BridgeTransferRequest): Promise<{
    receiveAmount: string;
    fee: string;
    estimatedTime: number;
  }>;

  /**
   * Check if allowance is sufficient (for chains that require approval)
   */
  checkAllowance?(params: {
    token: TokenInfo;
    owner: string;
    amount: string;
  }): Promise<boolean>;

  /**
   * Build approval transaction (for chains that require approval)
   */
  buildApprovalTx?(params: {
    token: TokenInfo;
    owner: string;
  }): Promise<unknown>;

  /**
   * Build send transaction
   */
  buildSendTx(request: BridgeTransferRequest): Promise<unknown>;

  /**
   * Get transfer status
   */
  getTransferStatus(transferId: string): Promise<{
    status: BridgeStatus;
    txHash?: string;
  }>;

  /**
   * Get average transfer time in milliseconds
   */
  getAverageTransferTime(
    sourceToken: TokenInfo,
    destinationToken: TokenInfo
  ): number;
}
