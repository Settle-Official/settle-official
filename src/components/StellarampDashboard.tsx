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
import {
  TransactionProgressModal,
  type OfframpStep,
} from "@/components/TransactionProgressModal";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  getAllbridgeQuote,
  getAllbridgeTokens,
  initializeAllbridgeSdk,
} from "@/lib/offramp/adapters/allbridge-adapter";

/** Run a promise with a timeout. Rejects with a clear message on expiry. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
  const [formResetKey, setFormResetKey] = useState(0);
  const [offrampStep, setOfframpStep] = useState<OfframpStep>("idle");
  const [offrampError, setOfframpError] = useState<string | null>(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
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
  const [stellarXlmBalance, setStellarXlmBalance] = useState<string | null>(
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
        setStellarXlmBalance(null);
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

        // Find USDC balance
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

        // Find XLM (native) balance
        const nativeBalance = balances.find(
          (balance: any) => balance?.asset_type === "native",
        );
        const xlmParsed = Number.parseFloat(nativeBalance?.balance ?? "0");
        const xlmDisplay = Number.isFinite(xlmParsed)
          ? xlmParsed.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            })
          : "0.00";
        setStellarXlmBalance(xlmDisplay);
      } catch (error) {
        console.error("Failed to fetch Stellar balances:", error);
        setStellarUsdcBalance("0.00");
        setStellarXlmBalance("0.00");
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
    feePaymentMethod?: "native" | "stablecoin";
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

    // Pre-flight: check USDC balance
    const usdcBal = parseFloat((stellarUsdcBalance ?? "0").replace(/,/g, ""));
    const sendAmount = parseFloat(tradeData.amount);
    if (usdcBal < sendAmount) {
      throw new Error(
        `Insufficient USDC balance. You have ${usdcBal.toFixed(2)} USDC but are trying to send ${sendAmount} USDC.`,
      );
    }

    // Pre-flight: if paying gas in XLM, check XLM balance vs approximate cost + reserve
    if (tradeData.feePaymentMethod === "native") {
      const xlmBal = parseFloat((stellarXlmBalance ?? "0").replace(/,/g, ""));
      // Stellar minimum reserve: base (1 XLM) + 0.5 per trustline/entry.
      // Conservatively assume 1.5 XLM reserve + ~0.01 tx fee.
      const MIN_XLM_RESERVE = 3; // conservative: 1 base + subentries + tx fee headroom
      // The native gas fee is ~2.26 XLM currently. If the user has less than
      // reserve + estimated gas, warn them before we hit the simulation error.
      const estimatedGas = 2.5; // rough upper bound for native gas
      if (xlmBal < MIN_XLM_RESERVE + estimatedGas) {
        throw new Error(
          `Insufficient XLM for native gas fee. You have ${xlmBal.toFixed(2)} XLM but need ~${(MIN_XLM_RESERVE + estimatedGas).toFixed(1)} XLM (gas + account reserve). Switch to USDC fee payment or add more XLM.`,
        );
      }
    }

    const baseReturnAddress = process.env.NEXT_PUBLIC_BASE_RETURN_ADDRESS;
    if (!baseReturnAddress) {
      throw new Error("NEXT_PUBLIC_BASE_RETURN_ADDRESS is missing");
    }

    const txId = TransactionStorage.generateId();
    setCurrentTxId(txId);
    setIsExecutingOfframp(true);
    setOfframpStep("initiating");
    setOfframpError(null);
    setShowProgressModal(true);

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

      const sdk = await withTimeout(
        initializeAllbridgeSdk(),
        15_000,
        "Allbridge SDK init",
      );
      const tokens = await withTimeout(
        getAllbridgeTokens(sdk),
        15_000,
        "Fetching token info",
      );
      if (!tokens?.stellar?.usdc || !tokens?.base?.usdc) {
        throw new Error("USDC tokens not found on Allbridge");
      }

      // 1) Compute post-bridge amount for Paycrest order amount
      const bridgeQuote = await withTimeout(
        getAllbridgeQuote(
          sdk,
          tokens.stellar.usdc,
          tokens.base.usdc,
          tradeData.amount,
        ),
        15_000,
        "Bridge quote",
      );
      const paycrestOrderAmount = Number.parseFloat(bridgeQuote.receiveAmount);
      if (!Number.isFinite(paycrestOrderAmount) || paycrestOrderAmount <= 0) {
        throw new Error("Invalid bridge receive amount for payout order");
      }
      // Floor to 6 decimals to ensure actual bridge deposit >= order amount.
      // Using toFixed(6) can round UP, causing a tiny overshoot that prevents
      // Paycrest from matching the deposit to the order.
      const normalizedOrderAmount = Math.floor(paycrestOrderAmount * 1e6) / 1e6;
      const normalizedRate = Number(tradeData.rate.toFixed(6));

      // 2) Create Paycrest order first via internal API route (avoids browser CORS/key exposure)
      const orderAbort = new AbortController();
      const orderTimer = setTimeout(() => orderAbort.abort(), 20_000);
      let orderResponse: Response;
      try {
        orderResponse = await fetch("/api/offramp/paycrest/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: orderAbort.signal,
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
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") {
          throw new Error(
            "Paycrest order request timed out (20s). Please try again.",
          );
        }
        throw new Error(`Paycrest order network error: ${fetchErr.message}`);
      } finally {
        clearTimeout(orderTimer);
      }
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
      const buildAbort = new AbortController();
      const buildTimer = setTimeout(() => buildAbort.abort(), 30_000);
      let buildTxResponse: Response;
      try {
        buildTxResponse = await fetch("/api/offramp/bridge/build-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: buildAbort.signal,
          body: JSON.stringify({
            amount: tradeData.amount,
            fromAddress: wallet.publicKey,
            toAddress: settlementAddress,
            feePaymentMethod: tradeData.feePaymentMethod || "stablecoin",
          }),
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") {
          throw new Error(
            "Build transaction timed out (30s). Please try again.",
          );
        }
        throw new Error(`Build transaction network error: ${fetchErr.message}`);
      } finally {
        clearTimeout(buildTimer);
      }
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
      setOfframpStep("awaiting-signature");
      const signedXdr = await signTransaction(xdr);

      // 5) Submit to Stellar network
      setOfframpStep("submitting");
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
        const submitAbort = new AbortController();
        const submitTimer = setTimeout(() => submitAbort.abort(), 15_000);
        let submitResponse: Response;
        try {
          submitResponse = await fetch("/api/offramp/bridge/submit-soroban", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: submitAbort.signal,
            body: JSON.stringify({ signedXdr }),
          });
        } catch (fetchErr: any) {
          if (fetchErr?.name === "AbortError") {
            throw new Error(
              "Submit transaction timed out (15s). Please try again.",
            );
          }
          throw new Error(
            `Submit transaction network error: ${fetchErr.message}`,
          );
        } finally {
          clearTimeout(submitTimer);
        }
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
        if (!submitPayload?.hash) {
          throw new Error(
            `Soroban submit missing hash: ${safeJson(submitPayload)}`,
          );
        }

        stellarTxHash = submitPayload.hash;

        // If PENDING, poll the lightweight tx-status endpoint from the client
        // instead of relying on server-side polling (avoids Vercel timeout).
        if (submitPayload?.status === "PENDING") {
          console.log(
            "[submit] Transaction PENDING — polling tx-status from client...",
          );
          const maxPollAttempts = 30; // 30 × 3s = 90s
          let confirmed = false;

          for (let i = 0; i < maxPollAttempts; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const statusRes = await fetch(
                `/api/offramp/bridge/tx-status/${stellarTxHash}`,
              );
              const statusData = await statusRes.json().catch(() => ({}));
              console.log(
                `[submit] tx-status poll ${i + 1}/${maxPollAttempts}: ${statusData?.status}`,
              );

              if (statusData?.status === "SUCCESS") {
                confirmed = true;
                break;
              }
              if (statusData?.status === "FAILED") {
                throw new Error(
                  "Transaction failed on-chain. Your wallet was not debited.",
                );
              }
              // NOT_FOUND — keep polling
            } catch (pollErr: any) {
              if (pollErr?.message?.includes("failed on-chain")) throw pollErr;
              console.warn("[submit] tx-status poll error:", pollErr.message);
            }
          }

          if (!confirmed) {
            throw new Error(
              "Transaction was not confirmed within 90s. It may have expired. Your wallet was likely not debited.",
            );
          }
        } else if (submitPayload?.status !== "SUCCESS") {
          throw new Error(
            `Transaction not confirmed (status: ${submitPayload?.status}). ` +
              (submitPayload?.error || "Please try again."),
          );
        }
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

      // 6) Poll bridge + payout status independently.
      setOfframpStep("processing");
      // Bridge polling is best-effort — Allbridge status API may 404 for a while.
      // Payout polling is what actually matters (Paycrest settling to the bank).
      const bridgeResult = pollBridgeStatus(txId, stellarTxHash).catch(
        (err) => {
          console.warn(
            "Bridge status polling ended without completion:",
            err.message,
          );
          // Don't fail the overall flow — bridge may still complete in background
        },
      );
      const payoutResult = pollPayoutStatus(txId, payoutOrderId);

      // Switch to "settling" once bridge is likely done (after a short delay)
      bridgeResult.then(() => {
        setOfframpStep((prev) => (prev === "processing" ? "settling" : prev));
      });

      // Payout settlement is the critical path — once fiat arrives, we're done.
      // Bridge polling is best-effort background info; don't block success on it.
      await payoutResult;

      // Mark as completed immediately — bridge may still be polling in background
      setOfframpStep("success");
      TransactionStorage.update(txId, { status: "completed" });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      // Reset the form so the user can start a fresh offramp
      setFormResetKey((k) => k + 1);
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
      setOfframpStep("error");
      setOfframpError(error.message);

      // Mark as failed
      TransactionStorage.update(txId, {
        status: "failed",
        error: error.message,
      });
      setUserTransactions(TransactionStorage.getByUser(wallet.publicKey));

      // Don't re-throw — the modal already shows the error to the user.
      // Re-throwing would cause an unhandled promise rejection.
    } finally {
      setIsExecutingOfframp(false);
      setCurrentTxId(null);
      // Don't close modal or reset step here — user dismisses modal manually
    }
  };

  const pollBridgeStatus = async (txId: string, txHash: string) => {
    const maxAttempts = 60;
    let attempts = 0;
    let consecutiveErrors = 0;
    const MAX_ERRORS = 10; // give up after 10 consecutive errors

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`/api/offramp/bridge/status/${txHash}`);
        if (!response.ok) {
          consecutiveErrors++;
          console.warn(
            `Bridge status poll HTTP ${response.status} (${consecutiveErrors}/${MAX_ERRORS})`,
          );
          if (consecutiveErrors >= MAX_ERRORS) {
            console.warn(
              "Bridge polling: too many consecutive errors, giving up",
            );
            return; // soft exit — don't throw
          }
          await new Promise((resolve) => setTimeout(resolve, 10000));
          attempts++;
          continue;
        }

        consecutiveErrors = 0; // reset on success
        const payload = await response.json();
        const status = payload?.data || payload;

        setTradeState((prev) => ({ ...prev, bridgeStatus: status.status }));
        TransactionStorage.update(txId, { bridgeStatus: status.status });
        setUserTransactions(TransactionStorage.getByUser(wallet!.publicKey));

        if (status.status === "completed") return;
        if (status.status === "failed")
          throw new Error("Bridge transfer failed");
      } catch (error: any) {
        if (error?.message === "Bridge transfer failed") throw error;
        consecutiveErrors++;
        console.warn(
          `Bridge status poll error (${consecutiveErrors}/${MAX_ERRORS}):`,
          error.message,
        );
        if (consecutiveErrors >= MAX_ERRORS) {
          console.warn(
            "Bridge polling: too many consecutive errors, giving up",
          );
          return; // soft exit
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    // Timeout is NOT fatal — bridge may still complete
    console.warn(
      "Bridge polling timeout (5 min) — bridge may still be processing",
    );
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

      // Advance modal to "settling" once Paycrest validates the deposit
      if (status.status === "validated" || status.status === "settled") {
        setOfframpStep((prev) =>
          prev === "processing" || prev === "settling" ? "settling" : prev,
        );
      }

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
            stellarXlmBalance={stellarXlmBalance}
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
                resetKey={formResetKey}
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

      <TransactionProgressModal
        isOpen={showProgressModal}
        currentStep={offrampStep}
        error={offrampError}
        onClose={() => {
          setShowProgressModal(false);
          setOfframpStep("idle");
          setOfframpError(null);
          setTradeState({});
          setIsExecutingOfframp(false);
        }}
      />
    </main>
  );
}
