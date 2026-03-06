"use client";

import { useState, useEffect, useCallback } from "react";
import { RECENT_OFFRAMPS } from "@/data/stellaramp";
import { FormCard } from "@/components/FormCard";
import { Header } from "@/components/Header";
import { ProgressSteps } from "@/components/ProgressSteps";
import { RecentOfframpsTable } from "@/components/RecentOfframpsTable";
import { RightPanel } from "@/components/RightPanel";
import { useStellarWallet } from "@/hooks/useStellarWallet";
import { TransactionStorage, Transaction } from "@/lib/transaction-storage";
import * as StellarSdk from "@stellar/stellar-sdk";

export function StellarampDashboard() {
  const {
    wallet,
    isConnected,
    isConnecting,
    connect,
    disconnect,
    signTransaction,
  } = useStellarWallet();

  const [currentTxId, setCurrentTxId] = useState<string | null>(null);
  const [tradeState, setTradeState] = useState<{
    stellarTxHash?: string;
    bridgeStatus?: string;
    payoutOrderId?: string;
    payoutStatus?: string;
    error?: string;
  }>({});
  const [userTransactions, setUserTransactions] = useState<Transaction[]>([]);
  const [pricingState, setPricingState] = useState<{
    amount: string;
    quote: {
      destinationAmount: string;
      rate: number;
      currency: string;
    } | null;
    isLoadingQuote: boolean;
    currency: string;
  }>({
    amount: "",
    quote: null,
    isLoadingQuote: false,
    currency: "NGN",
  });

  // Load user transactions when wallet connects
  useEffect(() => {
    if (wallet?.publicKey) {
      const txs = TransactionStorage.getByUser(wallet.publicKey);
      setUserTransactions(txs);
    }
  }, [wallet?.publicKey]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setUserTransactions([]);
  };

  const handleExecuteTrade = async (tradeData: {
    amount: string;
    beneficiary: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
      currency: string;
    };
  }) => {
    if (!wallet) {
      throw new Error("Wallet not connected");
    }

    const txId = TransactionStorage.generateId();
    setCurrentTxId(txId);

    // Create initial transaction record
    const transaction: Transaction = {
      id: txId,
      timestamp: Date.now(),
      userAddress: wallet.publicKey,
      amount: tradeData.amount,
      currency: "NGN",
      beneficiary: tradeData.beneficiary,
      status: "pending",
    };
    TransactionStorage.save(transaction);
    setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

    try {
      setTradeState({ bridgeStatus: "building" });

      // 1. Build Allbridge transaction
      const buildTxResponse = await fetch("/api/offramp/bridge/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: tradeData.amount,
          fromAddress: wallet.publicKey,
          toAddress: process.env.NEXT_PUBLIC_BASE_RETURN_ADDRESS,
        }),
      });

      const { xdr } = await buildTxResponse.json();

      // 2. Sign transaction with wallet
      const signedXdr = await signTransaction(xdr);

      // 3. Submit to Stellar network
      const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        StellarSdk.Networks.PUBLIC
      );
      const result = await server.submitTransaction(transaction as any);

      const stellarTxHash = result.hash;
      setTradeState((prev) => ({ ...prev, stellarTxHash, bridgeStatus: "pending" }));
      
      // Update transaction with tx hash
      TransactionStorage.update(txId, { stellarTxHash, bridgeStatus: "pending" });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      // 4. Poll bridge status
      await pollBridgeStatus(txId, stellarTxHash);

      // 5. Execute payout
      await executePayout(txId, stellarTxHash, tradeData);

      // Mark as completed
      TransactionStorage.update(txId, { status: "completed" });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      return stellarTxHash;
    } catch (error: any) {
      console.error("Trade execution error:", error);
      setTradeState((prev) => ({ ...prev, error: error.message }));
      
      // Mark as failed
      TransactionStorage.update(txId, { status: "failed", error: error.message });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));
      
      throw error;
    }
  };

  const pollBridgeStatus = async (txId: string, txHash: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await fetch(`/api/offramp/bridge/status/${txHash}`);
      const { data: status } = await response.json();

      setTradeState((prev) => ({ ...prev, bridgeStatus: status.status }));
      TransactionStorage.update(txId, { bridgeStatus: status.status });
      setUserTransactions(TransactionStorage.getByUser(wallet!.publicKey));

      if (status.status === "completed") return;
      if (status.status === "failed") throw new Error("Bridge transfer failed");

      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error("Bridge polling timeout");
  };

  const executePayout = async (txId: string, bridgeTransferId: string, tradeData: any) => {
    const response = await fetch("/api/offramp/execute-payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bridgeTransferId,
        amount: tradeData.amount,
        token: "USDC",
        rate: 1580,
        beneficiary: tradeData.beneficiary,
      }),
    });

    const { payoutOrderId } = await response.json();
    setTradeState((prev) => ({ ...prev, payoutOrderId, payoutStatus: "pending" }));
    TransactionStorage.update(txId, { payoutOrderId, payoutStatus: "pending" });
    setUserTransactions(TransactionStorage.getByUser(wallet!.publicKey));

    await pollPayoutStatus(txId, payoutOrderId);
  };

  const pollPayoutStatus = async (txId: string, orderId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await fetch(`/api/offramp/status/${orderId}`);
      const { data: status } = await response.json();

      setTradeState((prev) => ({ ...prev, payoutStatus: status.status }));
      TransactionStorage.update(txId, { payoutStatus: status.status });
      setUserTransactions(TransactionStorage.getByUser(wallet!.publicKey));

      if (["validated", "settled", "refunded", "expired"].includes(status.status)) return;

      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }

    throw new Error("Payout polling timeout");
  };

  const getSubtitle = () => {
    if (isConnecting) return "Connecting to wallet...";
    return "Convert Stellar USDC to your bank account in minutes.";
  };

  const handlePricingUpdate = useCallback((data: {
    amount: string;
    quote: {
      destinationAmount: string;
      rate: number;
      currency: string;
    } | null;
    isLoadingQuote: boolean;
    currency: string;
  }) => {
    setPricingState(data);
  }, []);

  return (
    <main className="min-h-screen p-4">
      <section className="min-h-[88vh] border border-[#1f1f1f] bg-[var(--bg)]">
        <div className="flex flex-col gap-6 px-[2.6rem] py-8 max-[720px]:p-4">
          <Header
            subtitle={getSubtitle()}
            isConnected={isConnected}
            isConnecting={isConnecting}
            walletAddress={wallet?.publicKey}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />

          <div className="grid grid-cols-[1fr_370px] gap-3 max-[1100px]:grid-cols-1">
            <div className="flex flex-col gap-3">
              <FormCard 
                isConnected={isConnected}
                isConnecting={isConnecting}
                onConnect={handleConnect}
                onPricingUpdate={handlePricingUpdate}
              />
              <RecentOfframpsTable rows={RECENT_OFFRAMPS} />
            </div>
            <RightPanel 
              isConnected={isConnected}
              isConnecting={isConnecting}
              amount={pricingState.amount}
              quote={pricingState.quote}
              isLoadingQuote={pricingState.isLoadingQuote}
              currency={pricingState.currency}
              onConnect={handleConnect}
            />
          </div>

          <ProgressSteps 
            isConnected={isConnected}
            isConnecting={isConnecting}
          />
        </div>
      </section>
    </main>
  );
}
