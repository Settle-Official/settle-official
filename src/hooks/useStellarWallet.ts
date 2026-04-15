"use client";

import { useState, useEffect, useCallback } from "react";
import { getStellarWalletAdapter, type StellarWallet, type WalletType } from "@/lib/stellar/wallet-adapter";

export function useStellarWallet() {
  const [wallet, setWallet] = useState<StellarWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adapter = getStellarWalletAdapter();

  useEffect(() => {
    const existingWallet = adapter.getWallet();
    if (existingWallet) setWallet(existingWallet);
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
        connectedWallet = await adapter.connectAuto();
      }
      setWallet(connectedWallet);
      return connectedWallet;
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /** Called after WalletConnect session is approved — sets wallet state directly. */
  const connectViaWalletConnect = useCallback((publicKey: string) => {
    const connectedWallet = adapter.connectWalletConnect(publicKey);
    setWallet(connectedWallet);
    return connectedWallet;
  }, []);

  const disconnect = useCallback(async () => {
    if (wallet?.type === "walletconnect") {
      const { disconnectWalletConnect } = await import("@/lib/stellar/walletconnect-adapter");
      await disconnectWalletConnect();
    }
    adapter.disconnect();
    setWallet(null);
    setError(null);
  }, [wallet]);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    if (!wallet) throw new Error("No wallet connected");
    try {
      return await adapter.signTransaction(xdr);
    } catch (err: any) {
      setError(err.message || "Failed to sign transaction");
      throw err;
    }
  }, [wallet]);

  return {
    wallet,
    isConnected: !!wallet,
    isConnecting,
    error,
    connect,
    connectViaWalletConnect,
    disconnect,
    signTransaction,
  };
}
