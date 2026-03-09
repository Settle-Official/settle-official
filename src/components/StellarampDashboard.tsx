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
import {
  getAllbridgeQuote,
  getAllbridgeTokens,
  initializeAllbridgeSdk,
} from "@/lib/offramp/adapters/allbridge-adapter";

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return String(value);
  }
}

function decodeTxResultCode(errorResultXdr?: string): string | null {
  if (!errorResultXdr) return null;
  try {
    const txResult = StellarSdk.xdr.TransactionResult.fromXDR(
      errorResultXdr,
      "base64",
    );
    const txCode = txResult.result().switch().name;
    const opResults = txResult.result().results();
    const firstOpCode =
      opResults && opResults.length > 0
        ? opResults[0]?.tr()?.switch()?.name
        : undefined;
    return firstOpCode ? `${txCode}/${firstOpCode}` : txCode;
  } catch {
    return null;
  }
}

function formatSorobanError(payload: any): string {
  if (!payload) return "Unknown Soroban error";
  const txCode = decodeTxResultCode(payload.errorResultXdr);
  const status = payload.status ? `status=${payload.status}` : null;
  const code = txCode ? `txCode=${txCode}` : null;
  const message =
    payload.error?.message ||
    payload.errorResult?.message ||
    payload.detail ||
    null;
  const raw = safeJson(payload);
  return [status, code, message, `raw=${raw}`].filter(Boolean).join(" | ");
}

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
  const [isExecutingOfframp, setIsExecutingOfframp] = useState(false);
  const [tradeState, setTradeState] = useState<{
    stellarTxHash?: string;
    bridgeStatus?: string;
    payoutOrderId?: string;
    payoutStatus?: string;
    error?: string;
  }>({});
  const [userTransactions, setUserTransactions] = useState<Transaction[]>([]);
  const [stellarUsdcBalance, setStellarUsdcBalance] = useState<string | null>(
    null,
  );
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [pricingState, setPricingState] = useState<{
    amount: string;
    quote: {
      destinationAmount: string;
      rate: number;
      currency: string;
      estimatedTimeMs: number;
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

  // Load connected wallet USDC balance from Stellar Horizon
  useEffect(() => {
    const loadUsdcBalance = async () => {
      if (!wallet?.publicKey) {
        setStellarUsdcBalance(null);
        return;
      }

      setIsLoadingBalance(true);
      try {
        const response = await fetch(
          `https://horizon.stellar.org/accounts/${wallet.publicKey}`,
        );
        if (!response.ok) {
          throw new Error(`Horizon account request failed: ${response.status}`);
        }

        const account = await response.json();
        const balances = Array.isArray(account?.balances)
          ? account.balances
          : [];
        const preferredIssuer = process.env.NEXT_PUBLIC_STELLAR_USDC_ISSUER;

        const usdcTrustline = balances.find((balance: any) => {
          if (
            balance?.asset_type !== "credit_alphanum4" &&
            balance?.asset_type !== "credit_alphanum12"
          ) {
            return false;
          }
          if (balance?.asset_code !== "USDC") return false;
          if (preferredIssuer) return balance?.asset_issuer === preferredIssuer;
          return true;
        });

        const parsed = Number.parseFloat(usdcTrustline?.balance ?? "0");
        const displayValue = Number.isFinite(parsed)
          ? parsed.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 6,
            })
          : "0.00";
        setStellarUsdcBalance(displayValue);
      } catch (error) {
        console.error("Failed to fetch Stellar USDC balance:", error);
        setStellarUsdcBalance("0.00");
      } finally {
        setIsLoadingBalance(false);
      }
    };

    loadUsdcBalance();
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
    rate: number;
    token: string;
    beneficiary: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
      currency: string;
      memo?: string;
    };
  }) => {
    if (!wallet) {
      throw new Error("Wallet not connected");
    }
    if (!pricingState.quote) {
      throw new Error("Quote unavailable. Please enter an amount first.");
    }

    const baseReturnAddress = process.env.NEXT_PUBLIC_BASE_RETURN_ADDRESS;
    if (!baseReturnAddress) {
      throw new Error("NEXT_PUBLIC_BASE_RETURN_ADDRESS is missing");
    }

    const txId = TransactionStorage.generateId();
    setCurrentTxId(txId);
    setIsExecutingOfframp(true);

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
      setTradeState({ bridgeStatus: "building", payoutStatus: "pending" });

      const sdk = await initializeAllbridgeSdk();
      const tokens = await getAllbridgeTokens(sdk);
      if (!tokens?.stellar?.usdc || !tokens?.base?.usdc) {
        throw new Error("USDC tokens not found on Allbridge");
      }

      // 1) Compute post-bridge amount for Paycrest order amount
      const bridgeQuote = await getAllbridgeQuote(
        sdk,
        tokens.stellar.usdc,
        tokens.base.usdc,
        tradeData.amount,
      );
      const paycrestOrderAmount = Number.parseFloat(bridgeQuote.receiveAmount);
      if (!Number.isFinite(paycrestOrderAmount) || paycrestOrderAmount <= 0) {
        throw new Error("Invalid bridge receive amount for payout order");
      }
      const normalizedOrderAmount = Number(paycrestOrderAmount.toFixed(6));
      const normalizedRate = Number(tradeData.rate.toFixed(6));

      // 2) Create Paycrest order first via internal API route (avoids browser CORS/key exposure)
      const orderResponse = await fetch("/api/offramp/paycrest/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: normalizedOrderAmount,
          token: tradeData.token,
          network: "base",
          rate: normalizedRate,
          reference: txId,
          recipient: {
            institution: tradeData.beneficiary.institution,
            accountIdentifier: tradeData.beneficiary.accountIdentifier,
            accountName: tradeData.beneficiary.accountName,
            memo: tradeData.beneficiary.memo || "Stellaramp offramp",
            currency: tradeData.beneficiary.currency,
          },
          returnAddress: baseReturnAddress,
        }),
      });
      if (!orderResponse.ok) {
        const payload = await orderResponse.json().catch(() => ({}));
        const details =
          payload?.details && typeof payload.details === "object"
            ? ` | details=${JSON.stringify(payload.details)}`
            : payload?.details
              ? ` | details=${String(payload.details)}`
              : "";
        throw new Error(
          `${payload?.message || payload?.error || `Paycrest order failed: ${orderResponse.status}`}${details}`,
        );
      }
      const orderPayload = await orderResponse.json();
      const paycrestOrder = orderPayload?.data || orderPayload;
      const payoutOrderId: string | undefined = paycrestOrder?.id;
      const settlementAddress: string | undefined =
        paycrestOrder?.receiveAddress;
      if (!payoutOrderId || !settlementAddress) {
        throw new Error("Paycrest order response missing id/receiveAddress");
      }
      setTradeState((prev) => ({
        ...prev,
        payoutOrderId,
        payoutStatus: "pending",
      }));
      TransactionStorage.update(txId, {
        payoutOrderId,
        payoutStatus: "pending",
      });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      // 3) Build Allbridge tx to Paycrest settlement wallet (server route to avoid client RPC issues)
      const buildTxResponse = await fetch("/api/offramp/bridge/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: tradeData.amount,
          fromAddress: wallet.publicKey,
          toAddress: settlementAddress,
        }),
      });
      if (!buildTxResponse.ok) {
        const payload = await buildTxResponse.json().catch(() => ({}));
        throw new Error(
          payload?.error ||
            `Failed to build bridge transaction: ${buildTxResponse.status}`,
        );
      }
      const buildTxPayload = await buildTxResponse.json();
      const xdr: string | undefined = buildTxPayload?.xdr;
      if (!xdr) {
        throw new Error("Bridge transaction payload missing XDR");
      }

      // 4) Sign transaction with wallet
      const signedXdr = await signTransaction(xdr);

      // 5) Submit to Stellar network
      console.log("Submitting transaction to Stellar network...");
      let stellarTxHash: string;

      // Detect Soroban ops safely – default to Soroban path since Allbridge
      // bridge txs are always invokeHostFunction.
      let hasSorobanOps = true;
      let signedTx:
        | StellarSdk.Transaction
        | StellarSdk.FeeBumpTransaction
        | null = null;
      try {
        signedTx = StellarSdk.TransactionBuilder.fromXDR(
          signedXdr,
          StellarSdk.Networks.PUBLIC,
        );
        if ("operations" in signedTx) {
          hasSorobanOps = signedTx.operations.some(
            (op: any) => op.type === "invokeHostFunction",
          );
        }
      } catch (parseErr) {
        console.warn(
          "Could not parse signed XDR to detect op types; defaulting to Soroban path:",
          parseErr,
        );
      }

      if (hasSorobanOps) {
        // Submit via server route which forwards raw XDR to the Soroban RPC
        // (no SDK re-serialisation – avoids stellar-base version mismatch).
        const submitResponse = await fetch(
          "/api/offramp/bridge/submit-soroban",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedXdr }),
          },
        );
        const submitPayload = await submitResponse.json().catch(() => ({}));
        console.log(
          "[submit] Response:",
          submitResponse.status,
          submitPayload?.status,
        );
        if (!submitResponse.ok) {
          throw new Error(
            submitPayload?.error ||
              `Soroban transaction error: ${formatSorobanError(
                submitPayload?.details || submitPayload,
              )}`,
          );
        }
        if (submitPayload?.status !== "SUCCESS") {
          throw new Error(
            `Transaction not confirmed (status: ${submitPayload?.status}). ` +
              (submitPayload?.error || "Please try again."),
          );
        }
        if (!submitPayload?.hash) {
          throw new Error(
            `Soroban submit missing hash: ${safeJson(submitPayload)}`,
          );
        }
        stellarTxHash = submitPayload.hash;
      } else if (signedTx) {
        // Classic tx path
        const server = new StellarSdk.Horizon.Server(
          "https://horizon.stellar.org",
        );
        const result = await server.submitTransaction(signedTx);
        stellarTxHash = result.hash;
      } else {
        throw new Error("Unable to parse or submit signed transaction");
      }

      setTradeState((prev) => ({
        ...prev,
        stellarTxHash,
        bridgeStatus: "pending",
      }));

      // Update transaction with tx hash
      TransactionStorage.update(txId, {
        stellarTxHash,
        bridgeStatus: "pending",
      });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      // 6) Poll bridge + payout status
      await Promise.all([
        pollBridgeStatus(txId, stellarTxHash),
        pollPayoutStatus(txId, payoutOrderId),
      ]);

      // Mark as completed
      TransactionStorage.update(txId, { status: "completed" });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));
    } catch (error: any) {
      console.error("Trade execution error:", error);

      // Log detailed Horizon error if available
      if (error?.response?.data) {
        console.error("Horizon error details:", {
          status: error.response.status,
          title: error.response.data.title,
          detail: error.response.data.detail,
          extras: error.response.data.extras,
        });
      }

      setTradeState((prev) => ({ ...prev, error: error.message }));

      // Mark as failed
      TransactionStorage.update(txId, {
        status: "failed",
        error: error.message,
      });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      throw error;
    } finally {
      setIsExecutingOfframp(false);
      setCurrentTxId(null);
    }
  };

  const pollBridgeStatus = async (txId: string, txHash: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await fetch(`/api/offramp/bridge/status/${txHash}`);
      if (!response.ok) {
        throw new Error(`Bridge status polling failed: ${response.status}`);
      }
      const payload = await response.json();
      const status = payload?.data || payload;

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

  const pollPayoutStatus = async (txId: string, orderId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await fetch(`/api/offramp/paycrest/order/${orderId}`);
      if (!response.ok) {
        throw new Error(`Paycrest status polling failed: ${response.status}`);
      }
      const payload = await response.json();
      const status = payload?.data || payload;

      setTradeState((prev) => ({ ...prev, payoutStatus: status.status }));
      TransactionStorage.update(txId, { payoutStatus: status.status });
      setUserTransactions(TransactionStorage.getByUser(wallet!.publicKey));

      if (
        ["validated", "settled", "refunded", "expired"].includes(status.status)
      )
        return;

      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }

    throw new Error("Payout polling timeout");
  };

  const getSubtitle = () => {
    if (isConnecting) return "Connecting to wallet...";
    return "Convert Stellar USDC to your bank account in minutes.";
  };

  const handlePricingUpdate = useCallback(
    (data: {
      amount: string;
      quote: {
        destinationAmount: string;
        rate: number;
        currency: string;
        estimatedTimeMs: number;
      } | null;
      isLoadingQuote: boolean;
      currency: string;
    }) => {
      setPricingState(data);
    },
    [],
  );

  return (
    <main className="min-h-screen p-4">
      <section className="min-h-[88vh] border border-[#1f1f1f] bg-[var(--bg)]">
        <div className="flex flex-col gap-6 px-[2.6rem] py-8 max-[720px]:p-4">
          <Header
            subtitle={getSubtitle()}
            isConnected={isConnected}
            isConnecting={isConnecting}
            walletAddress={wallet?.publicKey}
            stellarUsdcBalance={stellarUsdcBalance}
            isBalanceLoading={isLoadingBalance}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />

          <div className="grid grid-cols-[1fr_370px] gap-3 max-[1100px]:grid-cols-1">
            <div className="max-[1100px]:order-1">
              <FormCard
                isConnected={isConnected}
                isConnecting={isConnecting}
                isExecutingOfframp={isExecutingOfframp}
                onConnect={handleConnect}
                onInitiateOfframp={handleExecuteTrade}
                onPricingUpdate={handlePricingUpdate}
              />
            </div>
            <div className="row-span-2 col-start-2 max-[1100px]:order-2 max-[1100px]:row-auto max-[1100px]:col-auto">
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
            <div className="col-start-1 max-[1100px]:order-3 max-[1100px]:col-auto">
              <RecentOfframpsTable rows={RECENT_OFFRAMPS} />
            </div>
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
