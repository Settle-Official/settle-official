import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Submit a signed Soroban transaction directly to the Stellar Soroban RPC.
 *
 * We parse the signed XDR with the project's @stellar/stellar-sdk v14 for
 * diagnostic logging, but we still submit the raw base64 string to the RPC
 * so there is zero risk of re-serialisation drift.
 */

const SOROBAN_RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ||
  "https://soroban-rpc.mainnet.stellar.gateway.fm";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let jsonRpcId = 1;

async function sorobanRpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: jsonRpcId++,
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`Soroban RPC HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(
      `Soroban RPC error ${json.error.code}: ${json.error.message ?? JSON.stringify(json.error)}`,
    );
  }
  return json.result;
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

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const signedXdr = String(body?.signedXdr || "");

    if (!signedXdr) {
      return NextResponse.json(
        { error: "signedXdr is required" },
        { status: 400 },
      );
    }

    console.log(
      "[submit-soroban] Submitting signed XDR to Soroban RPC (length=%d, rpc=%s)",
      signedXdr.length,
      SOROBAN_RPC_URL,
    );

    // ---- Diagnostic: parse the signed tx to log auth expiration ----
    try {
      const NETWORK_PASSPHRASE =
        "Public Global Stellar Network ; September 2015";
      const parsed = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        NETWORK_PASSPHRASE,
      );
      if ("operations" in parsed) {
        for (const op of (parsed as StellarSdk.Transaction).operations) {
          if (op.type === "invokeHostFunction") {
            const ihfOp = op as StellarSdk.Operation.InvokeHostFunction;
            if (ihfOp.auth && ihfOp.auth.length > 0) {
              for (let i = 0; i < ihfOp.auth.length; i++) {
                const creds = ihfOp.auth[i].credentials();
                const credType = creds.switch().name;
                if (credType === "sorobanCredentialsAddress") {
                  const exp = creds.address().signatureExpirationLedger();
                  console.log(
                    "[submit-soroban] Auth entry %d: type=%s, signatureExpirationLedger=%d",
                    i,
                    credType,
                    exp,
                  );
                } else {
                  console.log(
                    "[submit-soroban] Auth entry %d: type=%s",
                    i,
                    credType,
                  );
                }
              }
            }
          }
        }
        console.log(
          "[submit-soroban] Parsed tx: source=%s, fee=%s, seq=%s, timeBounds=%s",
          (parsed as StellarSdk.Transaction).source,
          (parsed as StellarSdk.Transaction).fee,
          (parsed as StellarSdk.Transaction).sequence,
          JSON.stringify((parsed as StellarSdk.Transaction).timeBounds),
        );
      }
    } catch (parseErr: any) {
      console.warn(
        "[submit-soroban] Could not parse signed XDR for diagnostics:",
        parseErr?.message,
      );
    }

    // ---- 1. Send the raw signed XDR directly (no SDK re-serialisation) ----
    const sendResult = await sorobanRpc("sendTransaction", {
      transaction: signedXdr,
    });

    console.log(
      "[submit-soroban] sendTransaction full result:",
      safeJson(sendResult),
    );

    const hash: string | undefined = sendResult?.hash;
    const sendStatus: string = sendResult?.status || "UNKNOWN";

    // Log diagnostic info if present (Soroban RPC includes these on errors)
    if (sendResult?.errorResultXdr) {
      console.error(
        "[submit-soroban] errorResultXdr:",
        sendResult.errorResultXdr,
      );
    }
    if (sendResult?.diagnosticEventsXdr) {
      console.error(
        "[submit-soroban] diagnosticEventsXdr:",
        safeJson(sendResult.diagnosticEventsXdr),
      );
    }

    // Reject ERROR, DUPLICATE (already submitted but maybe failed), and
    // TRY_AGAIN_LATER statuses outright.
    if (
      sendStatus === "ERROR" ||
      sendStatus === "DUPLICATE" ||
      sendStatus === "TRY_AGAIN_LATER"
    ) {
      console.error(
        "[submit-soroban] sendTransaction rejected with status:",
        sendStatus,
      );
      return NextResponse.json(
        {
          error: `Soroban sendTransaction ${sendStatus}`,
          details: sendResult,
        },
        { status: 400 },
      );
    }

    if (!hash) {
      return NextResponse.json(
        {
          error: "Soroban submit did not return hash",
          details: sendResult,
        },
        { status: 500 },
      );
    }

    // ---- 2. If PENDING, poll getTransaction until resolved ----
    if (sendStatus === "PENDING") {
      const maxWait = 90; // seconds
      const interval = 3; // seconds between polls
      const attempts = Math.ceil(maxWait / interval);

      for (let i = 0; i < attempts; i++) {
        await new Promise((r) => setTimeout(r, interval * 1000));

        const txResult = await sorobanRpc("getTransaction", { hash });
        console.log(
          "[submit-soroban] poll %d/%d status=%s",
          i + 1,
          attempts,
          txResult?.status,
        );

        if (txResult?.status === "NOT_FOUND") continue;

        if (txResult?.status === "SUCCESS") {
          console.log("[submit-soroban] Transaction confirmed:", hash);
          return NextResponse.json({ hash, status: "SUCCESS" });
        }

        if (txResult?.status === "FAILED") {
          console.error(
            "[submit-soroban] Transaction failed on-chain:",
            safeJson(txResult),
          );
          return NextResponse.json(
            { error: "Soroban transaction failed on-chain", details: txResult },
            { status: 400 },
          );
        }
      }

      // Transaction never confirmed — treat as failure so the client
      // does NOT proceed to poll bridge/payout.
      console.error(
        "[submit-soroban] Transaction NOT confirmed after %ds — treating as failed. hash=%s",
        maxWait,
        hash,
      );
      return NextResponse.json(
        {
          error: `Transaction was not confirmed within ${maxWait}s. It may have expired or been rejected by validators.`,
          hash,
          status: "TIMEOUT",
        },
        { status: 504 },
      );
    }

    // Already SUCCESS or some other terminal status
    console.log(
      "[submit-soroban] sendTransaction returned terminal status:",
      sendStatus,
      "hash:",
      hash,
    );
    return NextResponse.json({
      hash,
      status: sendStatus,
    });
  } catch (error: any) {
    console.error("[submit-soroban] Error:", {
      message: error?.message,
      stack: error?.stack,
    });
    return NextResponse.json(
      {
        error: error?.message || "Failed to submit Soroban transaction",
        details:
          process.env.NODE_ENV === "development" ? error?.stack : undefined,
      },
      { status: 500 },
    );
  }
}
