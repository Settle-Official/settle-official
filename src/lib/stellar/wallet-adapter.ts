// Stellar Wallet Adapter - Supports Freighter, Lobstr, and WalletConnect (Freighter Mobile)

import * as freighterApi from "@stellar/freighter-api";

export type WalletType = "freighter" | "lobstr" | "walletconnect";

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent,
  );
}

/** True when running inside Freighter's in-app browser (window.freighter is injected). */
export function isInsideFreighterBrowser(): boolean {
  return typeof window !== "undefined" && !!(window as any).freighter;
}

export interface StellarWallet {
  type: WalletType;
  publicKey: string;
  isConnected: boolean;
}

export class StellarWalletAdapter {
  private walletType: WalletType | null = null;
  private publicKey: string | null = null;

  async isFreighterAvailable(): Promise<boolean> {
    try {
      const result = await freighterApi.isConnected();
      return result.isConnected || (typeof window !== "undefined" && !!(window as any).freighter);
    } catch {
      return false;
    }
  }

  isLobstrAvailable(): boolean {
    return typeof window !== "undefined" && (
      !!(window as any).lobstr ||
      !!(window as any).stellar?.isLobstr
    );
  }

  async connectFreighter(): Promise<StellarWallet> {
    try {
      const connectedResult = await freighterApi.isConnected();
      if (connectedResult.error) {
        throw new Error(connectedResult.error.message || "Freighter is not accessible");
      }

      let { address: publicKey, error } = await freighterApi.getAddress();
      if (error) throw new Error(error.message || "Failed to read Freighter address");

      if (!publicKey) {
        const accessResult = await freighterApi.requestAccess();
        if (accessResult.error || !accessResult.address) {
          throw new Error(accessResult.error?.message || "Freighter did not return an address");
        }
        publicKey = accessResult.address;
      }

      this.walletType = "freighter";
      this.publicKey = publicKey;
      return { type: "freighter", publicKey, isConnected: true };
    } catch (error: any) {
      throw new Error(`Failed to connect to Freighter: ${error.message}`);
    }
  }

  async connectLobstr(): Promise<StellarWallet> {
    try {
      if ((window as any).lobstr) {
        const result = await (window as any).lobstr.connect();
        this.walletType = "lobstr";
        this.publicKey = result.publicKey;
        return { type: "lobstr", publicKey: result.publicKey, isConnected: true };
      }

      if ((window as any).stellar?.isLobstr) {
        const result = await (window as any).stellar.connect();
        this.walletType = "lobstr";
        this.publicKey = result.publicKey;
        return { type: "lobstr", publicKey: result.publicKey, isConnected: true };
      }

      throw new Error("Lobstr wallet not found");
    } catch (error: any) {
      throw new Error(`Failed to connect to Lobstr: ${error.message}`);
    }
  }

  connectWalletConnect(publicKey: string): StellarWallet {
    this.walletType = "walletconnect";
    this.publicKey = publicKey;
    return { type: "walletconnect", publicKey, isConnected: true };
  }

  async connectAuto(): Promise<StellarWallet> {
    if (await this.isFreighterAvailable()) return this.connectFreighter();
    if (this.isLobstrAvailable()) return this.connectLobstr();
    throw new Error("No Stellar wallet found. Please install Freighter or Lobstr.");
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.walletType || !this.publicKey) throw new Error("No wallet connected");

    try {
      if (this.walletType === "freighter") {
        const { signedTxXdr, error } = await freighterApi.signTransaction(xdr, {
          networkPassphrase: "Public Global Stellar Network ; September 2015",
        });
        if (error || !signedTxXdr) throw new Error(error?.message || "Freighter failed to sign");
        return signedTxXdr;
      }

      if (this.walletType === "walletconnect") {
        const { signXdrViaWalletConnect } = await import("@/lib/stellar/walletconnect-adapter");
        return signXdrViaWalletConnect(xdr);
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

  getWallet(): StellarWallet | null {
    if (!this.walletType || !this.publicKey) return null;
    return { type: this.walletType, publicKey: this.publicKey, isConnected: true };
  }

  disconnect(): void {
    this.walletType = null;
    this.publicKey = null;
  }
}

let walletAdapter: StellarWalletAdapter | null = null;

export function getStellarWalletAdapter(): StellarWalletAdapter {
  if (!walletAdapter) walletAdapter = new StellarWalletAdapter();
  return walletAdapter;
}
