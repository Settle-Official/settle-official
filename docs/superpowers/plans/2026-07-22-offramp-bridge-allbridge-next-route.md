# Offramp Bridge: Allbridge Next (CCTP) Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Stellar→Base USDC offramp bridge by routing quotes, gas fees, and
transaction building through Allbridge Next's REST API (`api.next.allbridge.io`, CCTP
messenger) instead of the now-non-functional Allbridge Core SDK, for this one hardcoded pair.

**Architecture:** One new adapter module (`allbridge-next-adapter.ts`) wraps 3 REST calls
(`/quote`, `/tx/create`, `/transfer/status`). Four existing route files and one client
component are rewired to call it instead of the Allbridge Core SDK. The signed-transaction
submission path (`submit-soroban`) and the sign/submit/poll orchestration in
`StellarampDashboard.tsx` are untouched — they operate on a generic signed XDR string
regardless of which backend produced it.

**Tech Stack:** Next.js App Router API routes, TypeScript, plain `fetch` (no new
dependencies — this is a REST client, not an SDK integration).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-22-offramp-bridge-allbridge-next-route-design.md`
  — read it before starting; this plan implements it exactly, no re-litigating decisions.
- Only the offramp Stellar→Base leg changes. Do not touch `src/lib/onramp/base-bridge.ts`,
  `src/lib/onramp/finalize.ts`, `src/lib/onramp/check-status.ts`, or the onramp branch of
  `StellarampDashboard.tsx` — they import shared exports from `allbridge-adapter.ts` that
  must keep working unchanged.
- Do not delete `buildSwapAndBridgeTx`, `getAllbridgeGasFeeOptions`, or
  `getBridgeFeeForMethod` in `soroban-tx-builder.ts` — leave them in place, unused, as a
  rollback path (per design doc).
- **No test framework exists in this repo** (`package.json` has no `vitest`/`jest`/`ts-node`,
  no `*.test.ts` files anywhere) and none is being introduced for this change — that would
  be an unrelated scope expansion. Verification instead uses: (a) `npx tsc --noEmit` to
  catch type errors, and (b) `npm run dev` + `curl` against the real running route, which
  matches how this exact bug was originally diagnosed. This is a deliberate adaptation of
  the usual TDD flow to this codebase's actual conventions, not a shortcut — `api.next.allbridge.io`
  is a live, undocumented third-party API, so a mocked unit test would verify nothing real
  about whether the reverse-engineered request/response shapes actually work.
- All new/changed server code goes under `src/lib/offramp/` and `src/app/api/offramp/` —
  follow the existing file layout, do not introduce new top-level directories.
- `npm run dev` does not reliably bind port 3000 in this environment — it has previously
  auto-selected 3001 when 3000 was already occupied. Before running any `curl` step against
  "the dev server," check the actual port in the `npm run dev` terminal output
  (`- Local: http://localhost:XXXX`) and substitute it if different from 3000.

---

### Task 1: Allbridge Next REST adapter

**Files:**

- Modify: `src/lib/offramp/adapters/soroban-tx-builder.ts` (export `floatToInt`)
- Create: `src/lib/offramp/adapters/allbridge-next-adapter.ts`
- Modify: `.env.example` (document the optional override var)

**Interfaces:**

- Consumes: nothing from other tasks (this is the foundation task).
- Produces (used by Tasks 2–5):
  - `floatToInt(amount: string, decimals: number): string` — now exported from
    `soroban-tx-builder.ts`.
  - `intToFloat(amountInt: string, decimals: number): string` — exported from the new adapter.
  - `STELLAR_USDC_DECIMALS = 7`, `BASE_USDC_DECIMALS = 6` — exported constants.
  - `interface NextRelayerFee { tokenId: string; amount: string; approvalSpender?: string }`
  - `interface NextQuote { sourceTokenId: string; destinationTokenId: string; messenger: string; amount: string; amountOut: string; amountOutMin: string; relayerFees: NextRelayerFee[]; estimatedTime: number; [key: string]: unknown }`
  - `getNextQuote(amountFloat: string): Promise<NextQuote>`
  - `interface BridgeFeeOptionsNext { native: { int: string; float: string }; stablecoin: { int: string; float: string } }`
  - `getNextGasFeeOptions(amountFloat: string): Promise<BridgeFeeOptionsNext>`
  - `interface NextBridgeTxResult { tx: string; amountOut?: string; [key: string]: unknown }`
  - `createNextBridgeTx(params: { amountFloat: string; sourceAddress: string; destinationAddress: string; feePaymentMethod: "native" | "stablecoin" }): Promise<NextBridgeTxResult>`
  - `interface NextTransferStatus { status: "pending" | "processing" | "completed" | "failed"; txHash?: string }`
  - `getNextTransferStatus(txHash: string): Promise<NextTransferStatus>`

- [ ] **Step 1: Export `floatToInt` from `soroban-tx-builder.ts`**

In `src/lib/offramp/adapters/soroban-tx-builder.ts`, find:

```ts
function floatToInt(amount: string, decimals: number): string {
```

Change to:

```ts
export function floatToInt(amount: string, decimals: number): string {
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (there will likely be pre-existing unrelated errors/warnings in a
project with no prior strict typecheck pass — confirm none mention `soroban-tx-builder.ts`).

- [ ] **Step 3: Create the adapter file**

Create `src/lib/offramp/adapters/allbridge-next-adapter.ts`:

```ts
/**
 * Thin REST client for Allbridge Next's API (api.next.allbridge.io).
 *
 * This is NOT a documented/public API — there is no SDK and no docs. The shape
 * used here was reverse-engineered by inspecting next.allbridge.io's own network
 * traffic and minified JS bundle for the SRB:USDC -> BAS:USDC route. Allbridge
 * Core (the officially-supported @allbridge/bridge-core-sdk) no longer supports
 * this chain pair for any messenger — see
 * docs/superpowers/specs/2026-07-22-offramp-bridge-allbridge-next-route-design.md
 * for the full investigation.
 */

import { floatToInt } from "./soroban-tx-builder";

const NEXT_API_URL =
  process.env.ALLBRIDGE_NEXT_API_URL || "https://api.next.allbridge.io";

const STELLAR_USDC_TOKEN_ID = "SRB:USDC";
const BASE_USDC_TOKEN_ID = "BAS:USDC";

// Both plausible relayer-fee tokens on the Stellar side (native XLM stroops,
// and Stellar USDC) use 7 decimals, so one constant covers both.
export const STELLAR_USDC_DECIMALS = 7;
export const BASE_USDC_DECIMALS = 6;

export interface NextRelayerFee {
  tokenId: string;
  amount: string;
  approvalSpender?: string;
}

export interface NextQuote {
  sourceTokenId: string;
  destinationTokenId: string;
  messenger: string;
  amount: string;
  amountOut: string;
  amountOutMin: string;
  relayerFees: NextRelayerFee[];
  estimatedTime: number;
  [key: string]: unknown;
}

export interface NextBridgeTxResult {
  tx: string;
  amountOut?: string;
  [key: string]: unknown;
}

export interface NextTransferStatus {
  status: "pending" | "processing" | "completed" | "failed";
  txHash?: string;
}

export interface BridgeFeeOptionsNext {
  native: { int: string; float: string };
  stablecoin: { int: string; float: string };
}

export function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

async function nextApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NEXT_API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Allbridge Next API ${path} failed: ${res.status} ${bodyText}`,
    );
  }
  return res.json();
}

/**
 * Get a bridge quote for SRB:USDC -> BAS:USDC.
 * amountFloat is a human-readable string, e.g. "50" or "50.5".
 */
export async function getNextQuote(amountFloat: string): Promise<NextQuote> {
  const amountInt = floatToInt(amountFloat, STELLAR_USDC_DECIMALS);
  const quotes = await nextApiFetch<NextQuote[]>("/quote", {
    method: "POST",
    body: JSON.stringify({
      sourceTokenId: STELLAR_USDC_TOKEN_ID,
      destinationTokenId: BASE_USDC_TOKEN_ID,
      amount: amountInt,
    }),
  });
  const quote = quotes?.[0];
  if (!quote) {
    throw new Error(
      "Allbridge Next returned no quote for SRB:USDC -> BAS:USDC",
    );
  }
  return quote;
}

/**
 * Derive UI-facing fee options from a quote's relayerFees. Either bucket may
 * come back as "0" if Allbridge Next doesn't offer that payment method for
 * this route — callers must treat "0" as "unavailable", not "free".
 */
export async function getNextGasFeeOptions(
  amountFloat: string,
): Promise<BridgeFeeOptionsNext> {
  const quote = await getNextQuote(amountFloat);
  const nativeFee = quote.relayerFees.find((f) => f.tokenId === "native");
  const stablecoinFee = quote.relayerFees.find(
    (f) => f.tokenId === quote.sourceTokenId,
  );
  return {
    native: {
      int: nativeFee?.amount || "0",
      float: nativeFee
        ? intToFloat(nativeFee.amount, STELLAR_USDC_DECIMALS)
        : "0",
    },
    stablecoin: {
      int: stablecoinFee?.amount || "0",
      float: stablecoinFee
        ? intToFloat(stablecoinFee.amount, STELLAR_USDC_DECIMALS)
        : "0",
    },
  };
}

/**
 * Build an unsigned bridge transaction via Allbridge Next's /tx/create.
 * Returns the raw `tx` payload (XDR, since the source chain is Stellar) —
 * the caller signs it with the user's wallet exactly like the existing
 * Allbridge Core XDR flow, and submits via the existing submit-soroban route.
 */
export async function createNextBridgeTx(params: {
  amountFloat: string;
  sourceAddress: string;
  destinationAddress: string;
  feePaymentMethod: "native" | "stablecoin";
}): Promise<NextBridgeTxResult> {
  const { amountFloat, sourceAddress, destinationAddress, feePaymentMethod } =
    params;
  const quote = await getNextQuote(amountFloat);
  const { relayerFees, ...quoteRest } = quote;
  const wantedTokenId =
    feePaymentMethod === "native" ? "native" : quote.sourceTokenId;
  const relayerFee = relayerFees.find((f) => f.tokenId === wantedTokenId);
  if (!relayerFee) {
    throw new Error(
      `Allbridge Next did not return a "${feePaymentMethod}" relayer fee option for this route`,
    );
  }

  const body = {
    ...quoteRest,
    amount: floatToInt(amountFloat, STELLAR_USDC_DECIMALS),
    sourceAddress,
    destinationAddress,
    relayerFee,
  };

  const result = await nextApiFetch<NextBridgeTxResult>("/tx/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result?.tx || typeof result.tx !== "string") {
    throw new Error("Allbridge Next /tx/create returned no usable tx payload");
  }
  return result;
}

/**
 * Best-effort transfer status lookup. Never throws — callers treat this as
 * background polling info, not a gate (Paycrest's own payout detection is
 * the real completion signal). The exact query param name below (`txHash`)
 * is a best guess reverse-engineered from the bundle and unverified against
 * a live response; a wrong name just means this always reports "pending",
 * which is a safe (if uninformative) failure mode.
 */
export async function getNextTransferStatus(
  txHash: string,
): Promise<NextTransferStatus> {
  try {
    const result = await nextApiFetch<any>(
      `/transfer/status?txHash=${encodeURIComponent(txHash)}`,
    );
    const rawStatus = String(result?.status || "").toLowerCase();
    const status: NextTransferStatus["status"] =
      rawStatus === "completed"
        ? "completed"
        : rawStatus === "failed" || rawStatus === "refunded"
          ? "failed"
          : rawStatus === "processing"
            ? "processing"
            : "pending";
    return { status, txHash: result?.txHash || txHash };
  } catch {
    return { status: "pending", txHash };
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `allbridge-next-adapter.ts`.

- [ ] **Step 5: Manually verify the live quote call works**

This confirms the reverse-engineered `/quote` shape is still accurate before building on
top of it. Run:

```bash
curl -s -X POST https://api.next.allbridge.io/quote \
  -H "Content-Type: application/json" \
  -d '{"sourceTokenId":"SRB:USDC","destinationTokenId":"BAS:USDC","amount":"10000000"}'
```

Expected: HTTP 200 with a JSON array containing an object with `messenger`, `amountOut`,
`relayerFees`, `estimatedTime` fields (matches `NextQuote`). If this fails or the shape has
changed, stop and re-investigate before continuing — everything else in this plan depends
on it.

- [ ] **Step 6: Document the optional env override**

In `.env.example`, after the existing `# Allbridge Configuration (optional custom URLs)`
block, add:

```
# Allbridge Next (undocumented CCTP-routed API used for the Stellar<->Base
# offramp bridge, since Allbridge Core no longer supports this pair). Override
# only if Allbridge changes their endpoint.
# ALLBRIDGE_NEXT_API_URL=https://api.next.allbridge.io
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/offramp/adapters/soroban-tx-builder.ts src/lib/offramp/adapters/allbridge-next-adapter.ts .env.example
git commit -m "feat: add Allbridge Next REST adapter for Stellar<->Base bridging"
```

---

### Task 2: Rewire gas-fee-options route

**Files:**

- Modify: `src/app/api/offramp/bridge/gas-fee-options/route.ts` (full rewrite)

**Interfaces:**

- Consumes: `getNextGasFeeOptions` from Task 1.
- Produces: unchanged external contract — `GET` still returns
  `{ feeOptions: { native: {int,float}, stablecoin: {int,float} } }` on success, or
  `{ error: string }` with status 500 on failure (same shape `FormCard.tsx` already expects).

- [ ] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/offramp/bridge/gas-fee-options/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getNextGasFeeOptions } from "@/lib/offramp/adapters/allbridge-next-adapter";

export async function GET() {
  try {
    // Any positive placeholder amount works here — Allbridge Next's relayer
    // fee for this route is a flat gas-cost reimbursement, not a percentage,
    // so it doesn't vary with the amount the user eventually enters.
    const feeOptions = await getNextGasFeeOptions("1");
    return NextResponse.json({ feeOptions });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch gas fee options" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file.

- [ ] **Step 3: Start the dev server and verify the route**

Run: `npm run dev` (leave running in the background)

Then in another terminal:

```bash
curl -s http://localhost:3000/api/offramp/bridge/gas-fee-options | python3 -m json.tool
```

Expected: HTTP 200 (not 500) with a JSON body like:

```json
{
  "feeOptions": {
    "native": { "int": "...", "float": "..." },
    "stablecoin": { "int": "0", "float": "0" }
  }
}
```

(The `stablecoin` bucket may legitimately be `"0"` if Allbridge Next only offers a native
fee for this route — that's expected per the design doc's open question, not a bug.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/offramp/bridge/gas-fee-options/route.ts
git commit -m "fix: route gas-fee-options through Allbridge Next instead of broken Core API"
```

---

### Task 3: Rewire build-tx route

**Files:**

- Modify: `src/app/api/offramp/bridge/build-tx/route.ts` (full rewrite)

**Interfaces:**

- Consumes: `createNextBridgeTx` from Task 1.
- Produces: unchanged external contract — `POST` still returns
  `{ xdr: string, sourceToken: string, destinationToken: string }` on success (same field
  names `StellarampDashboard.tsx` already reads), or `{ error, details? }` with status 500.

- [ ] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/offramp/bridge/build-tx/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createNextBridgeTx } from "@/lib/offramp/adapters/allbridge-next-adapter";
import {
  validateAmount,
  validateAddress,
} from "@/lib/offramp/utils/validation";

// Allow up to 30s for the Allbridge Next API round trip
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress, feePaymentMethod } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json(
        { error: "Invalid Stellar address" },
        { status: 400 },
      );
    }
    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json(
        { error: "Invalid Base address" },
        { status: 400 },
      );
    }

    const selectedMethod: "native" | "stablecoin" =
      feePaymentMethod === "native" ? "native" : "stablecoin";

    const result = await createNextBridgeTx({
      amountFloat: amount,
      sourceAddress: fromAddress,
      destinationAddress: toAddress,
      feePaymentMethod: selectedMethod,
    });

    return NextResponse.json({
      xdr: result.tx,
      sourceToken: "USDC",
      destinationToken: "USDC",
    });
  } catch (error: any) {
    let userMessage = error.message || "Failed to build transaction";
    const msg = error.message || "";

    if (msg.includes("resulting balance is not within the allowed range")) {
      userMessage =
        "Insufficient XLM balance for the native gas fee. " +
        "Your remaining XLM would fall below Stellar's minimum account reserve. " +
        "Add more XLM to your wallet.";
    } else if (
      msg.includes("contract call failed") &&
      msg.includes("transfer")
    ) {
      userMessage =
        "A token transfer in the bridge contract failed during simulation. " +
        "This usually means insufficient balance for the amount + fees.";
    }

    return NextResponse.json(
      {
        error: userMessage,
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file.

- [ ] **Step 3: Verify with a real (unsigned) build request**

With `npm run dev` still running, use a real mainnet Stellar address you control (or any
valid-format Stellar `G...` address for the source and a valid `0x...` Base address for the
destination — the call still hits the live Allbridge Next API and will fail loudly if the
request shape is wrong, which is exactly what we're checking):

```bash
curl -s -X POST http://localhost:3000/api/offramp/bridge/build-tx \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "1",
    "fromAddress": "GABC...YOUR_TEST_ADDRESS",
    "toAddress": "0xABC...YOUR_TEST_ADDRESS",
    "feePaymentMethod": "native"
  }' | python3 -m json.tool
```

Expected: HTTP 200 with `{"xdr": "<long base64 string>", "sourceToken": "USDC", "destinationToken": "USDC"}`.
If this 500s, read the `error` message carefully — it tells you which assumption about the
`/tx/create` request body (in `createNextBridgeTx`) was wrong, and Task 1's adapter needs a
follow-up fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/offramp/bridge/build-tx/route.ts
git commit -m "fix: build offramp bridge tx via Allbridge Next instead of broken Core contract call"
```

---

### Task 4: Rewire bridge status route

**Files:**

- Modify: `src/app/api/offramp/bridge/status/[txHash]/route.ts` (full rewrite)

**Interfaces:**

- Consumes: `getNextTransferStatus` from Task 1.
- Produces: unchanged external contract — `GET` returns `{ data: { status, txHash, receiveAmount? } }`.

- [ ] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/offramp/bridge/status/[txHash]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getNextTransferStatus } from "@/lib/offramp/adapters/allbridge-next-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ txHash: string }> },
) {
  const { txHash } = await params;

  if (!txHash) {
    return NextResponse.json(
      { error: "Transaction hash required" },
      { status: 400 },
    );
  }

  // getNextTransferStatus never throws — it resolves to "pending" on any
  // lookup failure, since this polling is best-effort and doesn't gate
  // completion (Paycrest's own payout detection is the real success signal).
  const status = await getNextTransferStatus(txHash);
  return NextResponse.json({ data: status });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file.

- [ ] **Step 3: Verify with a dummy hash**

With `npm run dev` running:

```bash
curl -s http://localhost:3000/api/offramp/bridge/status/deadbeef | python3 -m json.tool
```

Expected: HTTP 200 with `{"data": {"status": "pending", "txHash": "deadbeef"}}` (a nonexistent
hash should resolve to pending, not throw a 500).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/offramp/bridge/status/[txHash]/route.ts"
git commit -m "fix: poll bridge status via Allbridge Next instead of broken Core status API"
```

---

### Task 5: Rewire the offramp quote route

**Files:**

- Modify: `src/app/api/offramp/quote/route.ts` (full rewrite)

**Interfaces:**

- Consumes: `getNextQuote`, `getNextGasFeeOptions`, `BASE_USDC_DECIMALS`, `intToFloat` from Task 1.
- Produces: response shape gains no new required fields for existing callers, but now accepts
  an optional `feePaymentMethod: "native" | "stablecoin"` body field (Task 6 will send it).
  Response fields unchanged: `{ quoteId, sourceAmount, destinationAmount, bridgeFee, payoutFee, amountAfterBridge, rate, estimatedTime, validUntil }`.

- [ ] **Step 1: Rewrite the route**

Replace the full contents of `src/app/api/offramp/quote/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import {
  getNextQuote,
  getNextGasFeeOptions,
  intToFloat,
  BASE_USDC_DECIMALS,
} from "@/lib/offramp/adapters/allbridge-next-adapter";
import {
  validateAmount,
  validateToken,
  validateCurrency,
} from "@/lib/offramp/utils/validation";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, token, currency, network, provider_id, feePaymentMethod } =
      body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateToken(token)) {
      return NextResponse.json(
        { error: "Invalid or unsupported token" },
        { status: 400 },
      );
    }
    if (!validateCurrency(currency)) {
      return NextResponse.json(
        { error: "Invalid or unsupported currency" },
        { status: 400 },
      );
    }

    const paycrestApiKey = process.env.PAYCREST_API_KEY;
    if (!paycrestApiKey) {
      throw new Error("PAYCREST_API_KEY not configured");
    }
    const paycrest = new PaycrestAdapter(paycrestApiKey);

    // When paying the bridge fee in stablecoin, it's deducted from the input
    // amount before bridging — re-quote with the post-fee amount for accuracy.
    let amountForBridge = amount;
    if (feePaymentMethod === "stablecoin") {
      const feeOptions = await getNextGasFeeOptions(amount);
      const stableFee = parseFloat(feeOptions.stablecoin.float);
      const afterFee = parseFloat(amount) - stableFee;
      if (afterFee <= 0) {
        return NextResponse.json(
          { error: "Amount is too small to cover the bridge fee" },
          { status: 400 },
        );
      }
      amountForBridge = afterFee.toFixed(7);
    }

    // 1) Allbridge Next: get amount received on Base USDC after bridge fee
    const bridgeQuote = await getNextQuote(amountForBridge);
    const receiveAmount = intToFloat(bridgeQuote.amountOut, BASE_USDC_DECIMALS);
    const amountAfterBridge = parseFloat(receiveAmount);

    // 2) Paycrest: convert post-bridge USDC amount to fiat rate/output
    const rate = await paycrest.getRate(token, receiveAmount, currency, {
      network: network || "base",
      providerId: provider_id,
    });

    // 3) Platform fee: 0.5%
    const grossFiat = amountAfterBridge * rate;
    const platformFeeRate = 0.005;
    const netFiat = grossFiat * (1 - platformFeeRate);

    const sourceAmount = amount;
    const destinationAmount = netFiat.toFixed(2);
    const bridgeFee = (parseFloat(amount) - amountAfterBridge).toString();
    const payoutFee = (grossFiat * platformFeeRate).toFixed(2);

    // Estimated time: Allbridge Next's own estimate (seconds) + ~2min Paycrest
    const estimatedTime = bridgeQuote.estimatedTime * 1000 + 2 * 60 * 1000;

    const quoteId = `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return NextResponse.json({
      quoteId,
      sourceAmount,
      destinationAmount,
      bridgeFee,
      payoutFee,
      amountAfterBridge: receiveAmount,
      rate,
      estimatedTime,
      validUntil: new Date(Date.now() + 5 * 60 * 1000),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to generate quote" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file.

- [ ] **Step 3: Verify with a real quote request**

With `npm run dev` running and a real `PAYCREST_API_KEY` set in `.env.local`:

```bash
curl -s -X POST http://localhost:3000/api/offramp/quote \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "10",
    "token": "USDC",
    "currency": "NGN",
    "network": "base",
    "feePaymentMethod": "native"
  }' | python3 -m json.tool
```

Expected: HTTP 200 with a full quote object — `destinationAmount` should be a plausible NGN
figure (10 USDC × current rate, minus fees), not `NaN` or missing.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/offramp/quote/route.ts
git commit -m "fix: quote offramp bridge amount via Allbridge Next instead of broken Core SDK"
```

---

### Task 6: Update FormCard.tsx to use the server quote route

**Files:**

- Modify: `src/components/FormCard.tsx`

**Interfaces:**

- Consumes: `POST /api/offramp/quote` (Task 5's response shape).
- Produces: no change to `FormCard`'s own exported props/behavior — `quote`, `isLoadingQuote`,
  `gasFeeOptions` state shapes are unchanged, so `StellarampDashboard.tsx` needs no changes.

- [ ] **Step 1: Remove the client-side Allbridge SDK imports and context helper**

In `src/components/FormCard.tsx`, remove this import block (lines 5–9):

```ts
import {
  getAllbridgeQuote,
  getAllbridgeTokens,
  initializeAllbridgeSdk,
} from "@/lib/offramp/adapters/allbridge-adapter";
```

And remove the `getAllbridgeContext` helper and its backing promise (originally lines 60–71):

```ts
let allbridgeContextPromise: Promise<{ sdk: any; tokens: any }> | null = null;

async function getAllbridgeContext() {
  if (!allbridgeContextPromise) {
    allbridgeContextPromise = (async () => {
      const sdk = await initializeAllbridgeSdk();
      const tokens = await getAllbridgeTokens(sdk);
      return { sdk, tokens };
    })();
  }
  return allbridgeContextPromise;
}
```

- [ ] **Step 2: Replace the quote effect**

Find the `useEffect` that starts with `// Get quote when amount or fee method changes`
(originally lines 258–338) and replace its entire body with:

```tsx
// Get quote when amount, currency, or fee method changes
useEffect(() => {
  const getQuote = async () => {
    if (amount && parseFloat(amount) >= 0.7) {
      setIsLoadingQuote(true);
      try {
        const response = await fetch("/api/offramp/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            token: "USDC",
            currency,
            network: "base",
            feePaymentMethod,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            payload?.error || `Quote request failed: ${response.status}`,
          );
        }
        const payload = await response.json();
        const directQuote: Quote = {
          quoteId: payload.quoteId,
          sourceAmount: payload.sourceAmount,
          destinationAmount: payload.destinationAmount,
          rate: payload.rate,
          currency,
          estimatedTimeMs: payload.estimatedTime,
        };

        if (!isValidQuote(directQuote)) {
          setQuote(null);
          return;
        }
        setQuote(directQuote);
      } catch (error) {
        setQuote(null);
      } finally {
        setIsLoadingQuote(false);
      }
    } else {
      setQuote(null);
    }
  };

  const debounce = setTimeout(getQuote, 500);
  return () => clearTimeout(debounce);
}, [amount, currency, feePaymentMethod]);
```

Note the dependency array dropped `gasFeeOptions` — the server route now looks up fresh fee
options itself on every request, so the client no longer needs to re-run the quote effect
when `gasFeeOptions` loads separately (this also removes a prior staleness/race risk where
the client-computed quote could use stale fee data).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `FormCard.tsx` (specifically, no more references to the
removed `getAllbridgeContext`/`getAllbridgeQuote`/etc.).

- [ ] **Step 4: Manual UI verification**

With `npm run dev` running, open `http://localhost:3000` in a browser:

1. Confirm the "PAY GAS FEE WITH" section loads real numbers instead of getting stuck on
   "Loading..." or showing a console 500 error.
2. Type `10` into the "AMOUNT IN USDC" field.
3. Confirm the suffix changes from "Min 0.7 USDC" to a real `≈ ₦ <number>` value within a
   couple seconds (not stuck on "..." indefinitely).
4. Open the browser devtools Network tab and confirm `/api/offramp/bridge/gas-fee-options`
   and `/api/offramp/quote` both return 200, not 500.

- [ ] **Step 5: Commit**

```bash
git add src/components/FormCard.tsx
git commit -m "fix: fetch offramp quote via server route instead of client-side Allbridge SDK"
```

---

### Task 7: Real end-to-end verification (manual, human-in-the-loop)

**Files:** none — this is a verification-only task, no code changes.

**Interfaces:** exercises the full chain built in Tasks 1–6 plus the untouched
`submit-soroban` route and `StellarampDashboard.tsx` orchestration.

> **This task must be run by a human with a real wallet, watching each step — do not let an
> autonomous agent click through this one unsupervised.** It involves signing and
> broadcasting a transaction moving real USDC on Stellar mainnet. Every prior task's `curl`
> checks confirm the API calls work; this is the one check that confirms the money actually
> arrives.

- [ ] **Step 1: Fund a small test amount**

Make sure the Stellar wallet you'll test with holds at least ~2 USDC and a small XLM
balance (for the native gas fee option) or ~2 USDC alone (for the stablecoin fee option).

- [ ] **Step 2: Run the full offramp flow with a small amount**

With `npm run dev` running, open the app, connect the real wallet, enter `1` (or the
minimum, `0.7`) as the amount, fill in real beneficiary bank details for a NGN payout,
and click through to completion. Watch for:

- The gas fee selector shows real numbers (not stuck loading).
- The settlement breakdown resolves to a real payout total (not stuck on "Calculating…").
- The wallet prompts you to sign a transaction (confirms `build-tx` produced valid XDR).
- After signing, the app reports a submitted transaction hash (confirms `submit-soroban`
  accepted the Allbridge-Next-built XDR without modification).

- [ ] **Step 3: Confirm funds actually bridged**

Look up the signed transaction hash on a Stellar block explorer (e.g.
`https://stellar.expert/explorer/public/tx/<hash>`) and confirm it succeeded on-chain.
Then check whether USDC actually landed on the Base destination address (the Paycrest
settlement address returned during the flow) — either via a Base block explorer
(`https://basescan.org/address/<address>`) or by confirming the Paycrest order in the app
progresses to a settled/completed state.

- [ ] **Step 4: Record the outcome**

If everything above worked: this plan is verified end-to-end, done.
If something failed: note exactly which step failed and the error message, and treat it as
a bug in the corresponding task's implementation (most likely candidate: the `/tx/create`
request body shape in `createNextBridgeTx`, since that's the one piece of this plan built
from reverse-engineered, unverified request semantics rather than an observed real response).

---

## Self-Review Notes

- **Spec coverage:** all 5 call sites listed in the design doc's "Call sites changed" section
  have a corresponding task (Tasks 2–6); the adapter itself is Task 1; the design doc's
  mandatory real-money test is Task 7. `submit-soroban` and `StellarampDashboard.tsx`'s
  sign/submit/poll code are explicitly called out as unchanged, matching the design doc.
- **Placeholder scan:** no TBD/TODO — the one genuinely unverified piece (`/tx/create`
  request shape, `/transfer/status` query param name) is implemented as real, runnable code
  with a comment stating the specific uncertainty and how a wrong guess fails safely,
  not left as a stub.
- **Type consistency:** `NextQuote`, `NextRelayerFee`, `NextBridgeTxResult`,
  `NextTransferStatus`, `BridgeFeeOptionsNext`, `intToFloat`, `floatToInt`,
  `STELLAR_USDC_DECIMALS`, `BASE_USDC_DECIMALS` are defined once in Task 1 and referenced
  identically (same names, same signatures) in every later task that uses them.
