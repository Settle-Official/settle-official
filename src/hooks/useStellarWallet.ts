"use client";

import { useState, useEffect, useCallback } from "react";
import { getStellarWalletAdapter, type StellarWallet, type WalletType } from "@/lib/stellar/wallet-adapter";

export function useStellarWallet() {
  const [wallet, setWallet] = useState<StellarWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adapter = getStellarWalletAdapter();

  // Check for existing connection on mount
  useEffect(() => {
    const existingWallet = adapter.getWallet();
    if (existingWallet) {
      setWallet(existingWallet);
    }
  }, []);

  const connect = useCallback(async (walletType?: WalletType) => {
    setIsConnecting(true);
    setError(null);

    try {
      let connectedWallet: StellarWallet;

      if (walletType === "freighter") {
        connectedWallet = await adapter.connectFreighter();
      } else if (walletType === "lobstr") {
        connectedWallet = await adapter.connectLobstr();
      } else {
        // Auto-detect
        connectedWallet = await adapter.connectAuto();
      }

      setWallet(connectedWallet);
      return connectedWallet;
    } catch (err: any) {
      const errorMessage = err.message || "Failed to connect wallet";
      setError(errorMessage);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    adapter.disconnect();
    setWallet(null);
    setError(null);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    if (!wallet) {
      throw new Error("No wallet connected");
    }

    try {
      const signedXdr = await adapter.signTransaction(xdr);
      return signedXdr;
    } catch (err: any) {
      const errorMessage = err.message || "Failed to sign transaction";
      setError(errorMessage);
      throw err;
    }
  }, [wallet]);

  return {
    wallet,
    isConnected: !!wallet,
    isConnecting,
    error,
    connect,
    disconnect,
    signTransaction,
  };
}
