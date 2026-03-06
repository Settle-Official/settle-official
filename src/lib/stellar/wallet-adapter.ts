// Stellar Wallet Adapter - Supports Freighter and Lobstr

import * as freighterApi from "@stellar/freighter-api";

export type WalletType = "freighter" | "lobstr";

export interface StellarWallet {
  type: WalletType;
  publicKey: string;
  isConnected: boolean;
}

export class StellarWalletAdapter {
  private walletType: WalletType | null = null;
  private publicKey: string | null = null;

  /**
   * Check if Freighter is installed
   */
  async isFreighterAvailable(): Promise<boolean> {
    try {
      const result = await freighterApi.isConnected();
      // In Freighter v6, isConnected can be false before access is granted.
      // Treat extension presence as availability so connect flow can request access.
      return result.isConnected || (typeof window !== "undefined" && !!(window as any).freighter);
    } catch {
      return false;
    }
  }

  /**
   * Check if Lobstr is available (via WalletConnect or browser extension)
   */
  isLobstrAvailable(): boolean {
    // Lobstr uses WalletConnect or can be detected via window object
    return typeof window !== "undefined" && (
      !!(window as any).lobstr ||
      !!(window as any).stellar?.isLobstr
    );
  }

  /**
   * Connect to Freighter wallet
   */
  async connectFreighter(): Promise<StellarWallet> {
    try {
      const connectedResult = await freighterApi.isConnected();
      if (connectedResult.error) {
        throw new Error(connectedResult.error.message || "Freighter is not accessible");
      }

      // Try reading already-available address first
      let { address: publicKey, error } = await freighterApi.getAddress();
      if (error) {
        throw new Error(error.message || "Failed to read Freighter address");
      }

      // If address is empty, request access/authorization and use returned address
      if (!publicKey) {
        const accessResult = await freighterApi.requestAccess();
        if (accessResult.error || !accessResult.address) {
          throw new Error(
            accessResult.error?.message || "Freighter did not return an address"
          );
        }
        publicKey = accessResult.address;
      }

      this.walletType = "freighter";
      this.publicKey = publicKey;

      return {
        type: "freighter",
        publicKey,
        isConnected: true,
      };
    } catch (error: any) {
      throw new Error(`Failed to connect to Freighter: ${error.message}`);
    }
  }

  /**
   * Connect to Lobstr wallet
   */
  async connectLobstr(): Promise<StellarWallet> {
    try {
      // Lobstr connection via their API
      if ((window as any).lobstr) {
        const result = await (window as any).lobstr.connect();
        this.walletType = "lobstr";
        this.publicKey = result.publicKey;

        return {
          type: "lobstr",
          publicKey: result.publicKey,
          isConnected: true,
        };
      }

      // Fallback to Stellar standard if available
      if ((window as any).stellar?.isLobstr) {
        const result = await (window as any).stellar.connect();
        this.walletType = "lobstr";
        this.publicKey = result.publicKey;

        return {
          type: "lobstr",
          publicKey: result.publicKey,
          isConnected: true,
        };
      }

      throw new Error("Lobstr wallet not found");
    } catch (error: any) {
      throw new Error(`Failed to connect to Lobstr: ${error.message}`);
    }
  }

  /**
   * Auto-detect and connect to available wallet
   */
  async connectAuto(): Promise<StellarWallet> {
    // Try Freighter first (most common)
    if (await this.isFreighterAvailable()) {
      return this.connectFreighter();
    }

    // Try Lobstr
    if (this.isLobstrAvailable()) {
      return this.connectLobstr();
    }

    throw new Error("No Stellar wallet found. Please install Freighter or Lobstr.");
  }

  /**
   * Sign a transaction with the connected wallet
   */
  async signTransaction(xdr: string): Promise<string> {
    if (!this.walletType || !this.publicKey) {
      throw new Error("No wallet connected");
    }

    try {
      if (this.walletType === "freighter") {
        const { signedTxXdr, error } = await freighterApi.signTransaction(xdr, {
          networkPassphrase: "Public Global Stellar Network ; September 2015",
        });
        if (error || !signedTxXdr) {
          throw new Error(error?.message || "Freighter failed to sign transaction");
        }
        return signedTxXdr;
      }

      if (this.walletType === "lobstr") {
        if ((window as any).lobstr) {
          const result = await (window as any).lobstr.signTransaction(xdr);
          return result.signedXdr;
        }

        if ((window as any).stellar?.isLobstr) {
          const result = await (window as any).stellar.signTransaction(xdr, {
            networkPassphrase: "Public Global Stellar Network ; September 2015",
          });
          return result.signedXdr;
        }
      }

      throw new Error("Wallet not available for signing");
    } catch (error: any) {
      throw new Error(`Failed to sign transaction: ${error.message}`);
    }
  }

  /**
   * Get current wallet info
   */
  getWallet(): StellarWallet | null {
    if (!this.walletType || !this.publicKey) {
      return null;
    }

    return {
      type: this.walletType,
      publicKey: this.publicKey,
      isConnected: true,
    };
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.walletType = null;
    this.publicKey = null;
  }
}

// Singleton instance
let walletAdapter: StellarWalletAdapter | null = null;

export function getStellarWalletAdapter(): StellarWalletAdapter {
  if (!walletAdapter) {
    walletAdapter = new StellarWalletAdapter();
  }
  return walletAdapter;
}
