# CCTP Direct Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Allbridge (Next for offramp, Core for onramp) with a direct Circle CCTP
integration for both Stellar↔Base bridge legs — full cutover, no live fallback.

**Architecture:** One shared, chain-agnostic CCTP core library (`src/lib/cctp/`) used by both
directions. Burns are submitted synchronously (user-signed for offramp, server-signed for onramp,
same as today); the attest→mint phase is durable (Redis-backed) and driven by SSE streams while a
tab is open, with the existing daily cron as an abandoned-session backstop — this project runs on
Vercel's Hobby plan, which only allows daily cron, so a minute-interval poller isn't available.

**Tech Stack:** `@stellar/stellar-sdk` (already a dependency), `viem` (already a dependency),
`@upstash/redis` (already a dependency), Node's built-in `node:test` runner for unit tests (zero
new dependency — this repo has no test framework today; Node 26 runs `.ts` files and `node:test`
natively, confirmed working during planning).

**Spec:** `docs/superpowers/specs/2026-08-20-cctp-direct-integration-design.md`

## Global Constraints

- Full cutover — no live Allbridge fallback. Existing `allbridge-next-adapter.ts` /
  `allbridge-adapter.ts` stay in place, unwired, as a rollback reference.
- All CCTP contract addresses and API endpoints below were pulled from Circle's raw markdown docs
  (not AI-summarized HTML) during planning, and cross-checked against this codebase's own existing
  derivation of the Stellar USDC contract ID — use the literal values given in each task; do not
  re-derive or substitute.
- Vercel Hobby plan: cron jobs run at most once/day. Do not add a new cron entry expecting more
  frequent execution — extend the existing daily `finalize-onramp` backstop instead.
- `src/app/api/offramp/bridge/submit-soroban/route.ts` is a generic "submit whatever signed XDR
  you're given" route reused across tx types — do not add CCTP-specific bookkeeping to it.
- Funds ledger entries have **no TTL** (permanent audit record). Operational `CctpTransferRecord`s
  keep a TTL (ephemeral, like the existing `OnrampRecord` pattern).

---

## Task 1: Test harness bootstrap

**Files:**
- Modify: `package.json`
- Create: `src/lib/cctp/__smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs `node --test` over every `*.test.ts` file under `src/`.

- [ ] **Step 1: Add the test script**

Edit `package.json`'s `"scripts"` block to add:

```json
"test": "node --test 'src/**/*.test.ts'"
```

- [ ] **Step 2: Write a smoke test**

```ts
// src/lib/cctp/__smoke.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("node:test runs TypeScript directly", () => {
  const x: number = 1 + 1;
  assert.equal(x, 2);
});
```

- [ ] **Step 3: Run it**

Run: `npm test`
Expected: 1 pass, output ends with `ℹ pass 1` / `ℹ fail 0`.

- [ ] **Step 4: Commit**

```bash
git add package.json src/lib/cctp/__smoke.test.ts
git commit -m "test: add node:test harness (no new dependency)"
```

---

## Task 2: CCTP network/domain/contract constants

**Files:**
- Create: `src/lib/cctp/constants.ts`
- Test: `src/lib/cctp/constants.test.ts`

**Interfaces:**
- Produces: `CCTP_NETWORK: "mainnet" | "testnet"`, `CCTP_DOMAIN: { stellar: 27, base: 6 }`,
  `CCTP_CONFIG: CctpAddresses` (selected for the active network), `STELLAR_USDC_DECIMALS = 7`,
  `BASE_USDC_DECIMALS = 6`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cctp/constants.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { CCTP_DOMAIN, CCTP_CONFIG, STELLAR_USDC_DECIMALS, BASE_USDC_DECIMALS } from "./constants";

test("domains match Circle's published values", () => {
  assert.equal(CCTP_DOMAIN.stellar, 27);
  assert.equal(CCTP_DOMAIN.base, 6);
});

test("mainnet config has real, correctly-shaped addresses", () => {
  assert.match(CCTP_CONFIG.stellarTokenMessengerMinter, /^C[A-Z0-9]{55}$/);
  assert.match(CCTP_CONFIG.stellarUsdc, /^C[A-Z0-9]{55}$/);
  assert.match(CCTP_CONFIG.baseTokenMessengerV2, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(STELLAR_USDC_DECIMALS, 7);
  assert.equal(BASE_USDC_DECIMALS, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./constants` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/constants.ts

/**
 * All addresses below were pulled directly from Circle's raw CCTP docs
 * (developers.circle.com/cctp/references/contract-addresses,
 * developers.circle.com/cctp/references/stellar-contracts,
 * developers.circle.com/stablecoins/usdc-contract-addresses) on 2026-08-20 —
 * not AI-summarized, hex/strkey addresses copied verbatim. The mainnet Stellar
 * USDC contract ID was cross-verified two ways: derived independently via
 * `Asset.contractId()` from the classic USDC asset, and matches the "CCW67..."
 * prefix already referenced in this codebase's existing
 * `soroban-tx-builder.ts` docstring for the (unrelated) Allbridge integration.
 */

export type CctpNetwork = "mainnet" | "testnet";

export const CCTP_NETWORK: CctpNetwork =
  process.env.CCTP_NETWORK === "testnet" ? "testnet" : "mainnet";

// Domain identifiers are protocol-wide constants, same on mainnet and testnet.
export const CCTP_DOMAIN = {
  stellar: 27,
  base: 6,
} as const;

// Fast Transfer vs Standard Transfer, per MessageTransmitterV2#sendMessage docs.
export const FINALITY_THRESHOLD = {
  fast: 1000,
  standard: 2000,
} as const;

export const STELLAR_USDC_DECIMALS = 7;
export const BASE_USDC_DECIMALS = 6;

export interface CctpAddresses {
  stellarTokenMessengerMinter: string;
  stellarMessageTransmitter: string;
  stellarCctpForwarder: string;
  stellarUsdc: string;
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  baseTokenMessengerV2: `0x${string}`;
  baseMessageTransmitterV2: `0x${string}`;
  baseUsdc: `0x${string}`;
  irisApiUrl: string;
}

const MAINNET: CctpAddresses = {
  stellarTokenMessengerMinter:
    "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL",
  stellarMessageTransmitter:
    "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
  stellarCctpForwarder:
    "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
  stellarUsdc: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  stellarRpcUrl:
    process.env.STELLAR_SOROBAN_RPC_URL ||
    "https://soroban-rpc.mainnet.stellar.gateway.fm",
  stellarNetworkPassphrase: "Public Global Stellar Network ; September 2015",
  baseTokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  baseMessageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  baseUsdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  irisApiUrl: process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com",
};

const TESTNET: CctpAddresses = {
  stellarTokenMessengerMinter:
    "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  stellarMessageTransmitter:
    "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  stellarCctpForwarder:
    "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  stellarUsdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  stellarRpcUrl:
    process.env.STELLAR_SOROBAN_RPC_URL_TESTNET ||
    "https://soroban-testnet.stellar.org",
  stellarNetworkPassphrase: "Test SDF Network ; September 2015",
  baseTokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  baseMessageTransmitterV2: "0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A",
  baseUsdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  irisApiUrl:
    process.env.CCTP_IRIS_API_URL_TESTNET ||
    "https://iris-api-sandbox.circle.com",
};

export const CCTP_CONFIG: CctpAddresses =
  CCTP_NETWORK === "testnet" ? TESTNET : MAINNET;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/constants.ts src/lib/cctp/constants.test.ts
git commit -m "feat(cctp): add network/domain/contract constants"
```

---

## Task 3: Address & hook-data encoding helpers

**Files:**
- Create: `src/lib/cctp/address-encoding.ts`
- Test: `src/lib/cctp/address-encoding.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `evmAddressToScvBytes32(evmAddress: string): xdr.ScVal`,
  `contractStrkeyToBytes32Hex(strkey: string): \`0x${string}\``,
  `zeroBytes32Scval(): xdr.ScVal`, `buildForwarderHookData(forwardRecipientStrkey: string): \`0x${string}\``.
  Used by Task 8 (Stellar burn builder) and Task 10 (Base burn-with-hook builder).

- [ ] **Step 1: Write the failing test**

These fixtures were computed independently during planning (a throwaway script running the exact
algorithm from Circle's docs against real-format inputs), not copied from this file's own
implementation — so the test actually catches a wrong byte offset or wrong padding direction.

```ts
// src/lib/cctp/address-encoding.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { xdr } from "@stellar/stellar-sdk";
import {
  evmAddressToScvBytes32,
  contractStrkeyToBytes32Hex,
  zeroBytes32Scval,
  buildForwarderHookData,
} from "./address-encoding";

test("evmAddressToScvBytes32 left-pads a 20-byte address into 32 bytes", () => {
  const scval = evmAddressToScvBytes32("0x000000000000000000000000000000000000dEaD");
  const bytes = scval.bytes();
  assert.equal(bytes.length, 32);
  assert.equal(
    Buffer.from(bytes).toString("hex"),
    "000000000000000000000000000000000000000000000000000000000000dead",
  );
});

test("evmAddressToScvBytes32 rejects a malformed address", () => {
  assert.throws(() => evmAddressToScvBytes32("0x1234"));
});

test("contractStrkeyToBytes32Hex matches a known real testnet contract", () => {
  // CctpForwarder testnet address, decoded independently via StrKey.decodeContract
  // during planning.
  const hex = contractStrkeyToBytes32Hex(
    "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  );
  assert.equal(
    hex,
    "0x3de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e",
  );
});

test("zeroBytes32Scval is 32 zero bytes", () => {
  const bytes = zeroBytes32Scval().bytes();
  assert.equal(bytes.length, 32);
  assert.ok(Buffer.from(bytes).every((b) => b === 0));
});

test("buildForwarderHookData matches Circle's documented byte layout", () => {
  const hookData = buildForwarderHookData(
    "GABC7MTIGP4Q5DYYCEUEBTHKR4EBSJVK4WI3FEIY73KVCUZ4LRAVWCZP",
  );
  assert.equal(
    hookData,
    "0x000000000000000000000000000000000000000000000000000000000000003847414243374d54494750345135445959434555454254484b52344542534a564b345749334645495937334b5643555a344c52415657435a50",
  );
});

test("buildForwarderHookData rejects an invalid recipient", () => {
  assert.throws(() => buildForwarderHookData("not-a-real-address"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./address-encoding` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/address-encoding.ts
import { StrKey, xdr } from "@stellar/stellar-sdk";

/**
 * CCTP `mintRecipient`/`destinationCaller` fields are always bytes32. For a
 * plain 20-byte EVM address, left-pad with 12 zero bytes (matches the
 * existing left-pad logic already used for the old Allbridge integration in
 * soroban-tx-builder.ts's swap_and_bridge call).
 */
export function evmAddressToScvBytes32(evmAddress: string): xdr.ScVal {
  const hex = evmAddress.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`Invalid EVM address: ${evmAddress}`);
  }
  const padded = Buffer.concat([Buffer.alloc(12), Buffer.from(hex, "hex")]);
  return xdr.ScVal.scvBytes(padded);
}

/** Decode a Stellar contract strkey (C...) into its raw 32-byte bytes32 hex form. */
export function contractStrkeyToBytes32Hex(strkey: string): `0x${string}` {
  if (!StrKey.isValidContract(strkey)) {
    throw new Error(`Invalid contract strkey: ${strkey}`);
  }
  const hex = Buffer.from(StrKey.decodeContract(strkey)).toString("hex");
  return `0x${hex}`;
}

/** `destination_caller` of all-zero bytes32 means "anyone may call receiveMessage". */
export function zeroBytes32Scval(): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.alloc(32));
}

/**
 * Byte layout per Circle's Stellar CCTP docs:
 *   bytes 0-23:  zero padding
 *   bytes 24-27: hook version (u32, currently 0)
 *   bytes 28-31: forward recipient strkey byte length (u32)
 *   bytes 32+:   forward recipient strkey as UTF-8
 *
 * Used only when the CCTP destination is Stellar and the real recipient is a
 * plain account (G...) or muxed (M...) address — CCTP treats `mintRecipient`
 * as a contract address on Stellar, so account/muxed recipients must go
 * through CctpForwarder with the real address carried in this hook data.
 */
export function buildForwarderHookData(
  forwardRecipientStrkey: string,
): `0x${string}` {
  const isValid =
    StrKey.isValidEd25519PublicKey(forwardRecipientStrkey) ||
    StrKey.isValidContract(forwardRecipientStrkey) ||
    StrKey.isValidMed25519PublicKey(forwardRecipientStrkey);
  if (!isValid) {
    throw new Error(
      `Invalid forward recipient: ${forwardRecipientStrkey} (expected G..., C..., or M... address)`,
    );
  }
  const recipientBytes = Buffer.from(forwardRecipientStrkey, "utf8");
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24); // hook version = 0
  hookData.writeUInt32BE(recipientBytes.length, 28);
  recipientBytes.copy(hookData, 32);
  return `0x${hookData.toString("hex")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/address-encoding.ts src/lib/cctp/address-encoding.test.ts
git commit -m "feat(cctp): add address/hook-data encoding helpers"
```

---

## Task 4: Funds ledger module

**Files:**
- Create: `src/lib/ledger/funds-ledger.ts`
- Test: `src/lib/ledger/funds-ledger.test.ts`

**Interfaces:**
- Produces: `FundsLedgerEntry` type, `recordLedgerEntry(entry): Promise<FundsLedgerEntry>`,
  `listLedgerEntries(opts?: { limit?: number }): Promise<FundsLedgerEntry[]>`.
- Consumed by: Task 5 (onramp settlement wiring), Task 13 (offramp burn wiring).

This module talks to real Redis (Upstash), so its test only covers the pure id/shape logic that
doesn't require a live connection — the actual read/write path is exercised for real once wired
into Task 5/13 and verified against the dev server, consistent with how the rest of this
codebase tests Redis-backed code (no mocking Upstash; `onramp-store.ts` has no unit tests either,
verified live).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ledger/funds-ledger.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerEntry } from "./funds-ledger";

test("buildLedgerEntry fills id and recordedAt, keeps given fields", () => {
  const entry = buildLedgerEntry({
    direction: "onramp",
    wallet: "base_hot_wallet",
    chain: "base",
    asset: "USDC",
    amount: "50.00",
    txHash: "0xabc",
    orderId: "order-1",
  });
  assert.equal(entry.direction, "onramp");
  assert.equal(entry.amount, "50.00");
  assert.ok(entry.id.length > 0);
  assert.ok(entry.recordedAt > 0);
});

test("buildLedgerEntry allows an offramp entry with no wallet", () => {
  const entry = buildLedgerEntry({
    direction: "offramp",
    chain: "stellar",
    asset: "USDC",
    amount: "10.5",
    txHash: "deadbeef",
    orderId: "order-2",
  });
  assert.equal(entry.wallet, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./funds-ledger` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/ledger/funds-ledger.ts
/**
 * Permanent audit log of real fund movements into wallets this platform
 * controls — separate from operational bridge-state records (which are
 * ephemeral and expire). This is a financial record meant to accumulate, so
 * entries have NO TTL, unlike every other Redis record in this codebase.
 */

import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ENTRY_KEY = (id: string) => `ledger:entry:${id}`;
const INDEX_KEY = "ledger:index"; // sorted set, score = recordedAt

export interface FundsLedgerEntry {
  id: string;
  direction: "onramp" | "offramp";
  /** Only set when funds actually land in a wallet we control. */
  wallet?: "base_hot_wallet" | "stellar_hot_wallet";
  chain: "base" | "stellar";
  asset: "USDC";
  amount: string;
  txHash: string;
  orderId?: string;
  recordedAt: number;
}

export function buildLedgerEntry(
  fields: Omit<FundsLedgerEntry, "id" | "recordedAt">,
): FundsLedgerEntry {
  return { ...fields, id: randomUUID(), recordedAt: Date.now() };
}

export async function recordLedgerEntry(
  fields: Omit<FundsLedgerEntry, "id" | "recordedAt">,
): Promise<FundsLedgerEntry> {
  const entry = buildLedgerEntry(fields);
  await redis.set(ENTRY_KEY(entry.id), entry); // no `ex` — permanent
  await redis.zadd(INDEX_KEY, { score: entry.recordedAt, member: entry.id });
  return entry;
}

export async function listLedgerEntries(
  opts: { limit?: number } = {},
): Promise<FundsLedgerEntry[]> {
  const limit = opts.limit ?? 100;
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, {
    rev: true,
  });
  if (ids.length === 0) return [];
  const entries = await Promise.all(
    ids.map((id) => redis.get<FundsLedgerEntry>(ENTRY_KEY(id))),
  );
  return entries.filter((e): e is FundsLedgerEntry => e !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger/funds-ledger.ts src/lib/ledger/funds-ledger.test.ts
git commit -m "feat(ledger): add permanent funds ledger (no-TTL Redis audit log)"
```

---

## Task 5: Wire the funds ledger into onramp settlement

**Files:**
- Modify: `src/lib/onramp/handle-settlement.ts`
- Modify: `src/app/api/webhooks/paycrest/route.ts:154`

**Interfaces:**
- Consumes: `recordLedgerEntry` from Task 4.
- Produces: `handleOnrampSettled(orderId, settledAmount?, settlementTxHash?)` — new third
  parameter, backward compatible (optional).

This is the point in the codebase where real USDC is already confirmed landing in the Base hot
wallet today (Paycrest's settlement payout, before any bridging) — independent of the CCTP work,
ships on its own.

- [ ] **Step 1: Thread the settlement tx hash through from the webhook**

In `src/app/api/webhooks/paycrest/route.ts`, change line 154 from:

```ts
await handleOnrampSettled(orderId, data?.amount);
```

to:

```ts
await handleOnrampSettled(orderId, data?.amount, data?.txHash);
```

- [ ] **Step 2: Record the ledger entry in `handleOnrampSettled`**

In `src/lib/onramp/handle-settlement.ts`, add the import:

```ts
import { recordLedgerEntry } from "@/lib/ledger/funds-ledger";
```

Change the function signature from:

```ts
export async function handleOnrampSettled(
  orderId: string,
  settledAmount?: string,
): Promise<void> {
```

to:

```ts
export async function handleOnrampSettled(
  orderId: string,
  settledAmount?: string,
  settlementTxHash?: string,
): Promise<void> {
```

Immediately after the existing `amount` resolution block (right after the `if (!amount) { ... return; }` early-return, before the `try { await updateOnrampOrder(...)` call), add:

```ts
  await recordLedgerEntry({
    direction: "onramp",
    wallet: "base_hot_wallet",
    chain: "base",
    asset: "USDC",
    amount,
    txHash: settlementTxHash || "unknown",
    orderId,
  });
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, then trigger a test webhook call (or inspect the next real onramp settlement
in logs) and confirm via `listLedgerEntries()` (temporarily call it from a scratch script or a
Node REPL with env vars loaded) that a `direction: "onramp"` entry appears with the expected
amount.

- [ ] **Step 4: Commit**

```bash
git add src/lib/onramp/handle-settlement.ts src/app/api/webhooks/paycrest/route.ts
git commit -m "feat(ledger): record onramp settlement receipts in the funds ledger"
```

---

## Task 6: Iris attestation API client

**Files:**
- Create: `src/lib/cctp/iris-client.ts`
- Test: `src/lib/cctp/iris-client.test.ts`

**Interfaces:**
- Consumes: `CCTP_CONFIG` from Task 2.
- Produces: `getBurnFeeQuote(params): Promise<BurnFeeQuote>`,
  `fetchAttestation(params): Promise<AttestationMessage | null>`,
  `reattest(nonce: string): Promise<void>`.
- Consumed by: Task 8/10 (fee quotes), Task 12 (advance function's attestation polling).

- [ ] **Step 1: Write the failing test**

Only the URL-building logic is unit-tested here (deterministic, no network). The actual HTTP
behavior is verified manually against the real sandbox API in Step 4, matching how this codebase
already treats third-party network calls (see `allbridge-next-adapter.ts` — no mocked-network
unit tests, verified live).

```ts
// src/lib/cctp/iris-client.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildMessagesUrl, buildFeeQuoteUrl } from "./iris-client";

test("buildMessagesUrl puts domain in the path and txHash in the query", () => {
  const url = buildMessagesUrl("https://iris-api.circle.com", 27, "abc123");
  assert.equal(
    url,
    "https://iris-api.circle.com/v2/messages/27?transactionHash=abc123",
  );
});

test("buildFeeQuoteUrl encodes source and destination domains", () => {
  const url = buildFeeQuoteUrl("https://iris-api.circle.com", 27, 6);
  assert.equal(
    url,
    "https://iris-api.circle.com/v2/burn/USDC/fees/27/6",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./iris-client` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/iris-client.ts
import { CCTP_CONFIG } from "./constants";

export interface AttestationMessage {
  message: string;
  attestation: string;
  status: string;
  eventNonce?: string;
}

interface AttestationResponse {
  messages: AttestationMessage[];
}

export interface BurnFeeQuote {
  /** Fee in the burn token's smallest unit (matches source-chain decimals), as a string. */
  minimumFee: string;
}

export function buildMessagesUrl(
  baseUrl: string,
  sourceDomain: number,
  transactionHash: string,
): string {
  return `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
}

export function buildFeeQuoteUrl(
  baseUrl: string,
  sourceDomain: number,
  destDomain: number,
): string {
  return `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`;
}

/**
 * Single-shot attestation fetch (no internal polling loop — the caller
 * decides cadence, since offramp/onramp drive this from different places:
 * SSE tick vs daily cron sweep). Returns null while still pending; throws on
 * a real HTTP error other than 404 (not-found-yet is expected while pending).
 */
export async function fetchAttestation(params: {
  sourceDomain: number;
  transactionHash: string;
}): Promise<AttestationMessage | null> {
  const url = buildMessagesUrl(
    CCTP_CONFIG.irisApiUrl,
    params.sourceDomain,
    params.transactionHash,
  );
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Iris /v2/messages failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as AttestationResponse;
  const first = data.messages?.[0];
  if (!first || first.status !== "complete") return null;
  return first;
}

/** Real, live fee quote — replaces the old flat/guessed Allbridge relayer fee. */
export async function getBurnFeeQuote(params: {
  sourceDomain: number;
  destDomain: number;
}): Promise<BurnFeeQuote> {
  const url = buildFeeQuoteUrl(
    CCTP_CONFIG.irisApiUrl,
    params.sourceDomain,
    params.destDomain,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Iris fee quote failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  // Response is an array of finality-threshold-keyed fee entries; take the
  // Fast Transfer (finalityThreshold: 1000) entry's minimumFee.
  const fast = Array.isArray(data)
    ? data.find((e: any) => e.finalityThreshold === 1000)
    : undefined;
  return { minimumFee: String(fast?.minimumFee ?? "0") };
}

/** Recover an expired/stuck Fast Transfer attestation. */
export async function reattest(nonce: string): Promise<void> {
  const res = await fetch(`${CCTP_CONFIG.irisApiUrl}/v2/reattest/${nonce}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Iris reattest failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes, then verify live**

Run: `npm test` — expect PASS.

Then verify the fee-quote shape against the real sandbox API (manual, network-dependent):

```bash
curl -s "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/27/6"
```

Confirm the response is an array with a `finalityThreshold: 1000` entry containing a
`minimumFee` field — if the actual field names differ from what Step 3 assumed, fix
`getBurnFeeQuote`'s parsing to match before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/iris-client.ts src/lib/cctp/iris-client.test.ts
git commit -m "feat(cctp): add Iris attestation/fee-quote API client"
```

---

## Task 7: New Stellar hot wallet

**Files:**
- Create: `src/lib/cctp/stellar-hot-wallet.ts`

**Interfaces:**
- Produces: `getCctpStellarAccount(): Keypair`, `assertStellarGasFloor(): Promise<void>`.
- Consumed by: Task 9 (onramp mint-and-forward submission).

Mirrors `src/lib/onramp/base-bridge.ts`'s `getAccount()` / gas-floor-check pattern, applied to
Stellar's native XLM gas instead of Base's ETH.

**Env:** `CCTP_STELLAR_HOT_WALLET_SECRET` (Stellar secret key, `S...`), `CCTP_STELLAR_MIN_GAS_XLM`
(optional, default `2` — Stellar's base reserve plus margin for a Soroban invocation).

- [ ] **Step 1: Write the implementation**

No unit test here — this reads a live secret and checks a live balance; there's nothing pure to
assert against without a real funded testnet account, which Task 21 (testnet verification)
exercises for real.

```ts
// src/lib/cctp/stellar-hot-wallet.ts
/**
 * New server-signing Stellar wallet, used only to submit `mint_and_forward` on
 * the CCTP Forwarder for the onramp Base→Stellar leg. Pays XLM gas only —
 * mint_and_forward is atomic (mints then forwards in one Soroban invocation),
 * so this wallet never custodies bridged USDC even momentarily.
 *
 * Env:
 *   CCTP_STELLAR_HOT_WALLET_SECRET — Stellar secret key (S...), server secret
 *   CCTP_STELLAR_MIN_GAS_XLM       — optional XLM floor (default 2)
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { CCTP_CONFIG } from "./constants";

export class CctpGasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpGasError";
  }
}

export function getCctpStellarAccount(): StellarSdk.Keypair {
  const secret = process.env.CCTP_STELLAR_HOT_WALLET_SECRET;
  if (!secret) {
    throw new Error("CCTP_STELLAR_HOT_WALLET_SECRET not configured");
  }
  return StellarSdk.Keypair.fromSecret(secret);
}

/** Refuses (throws) rather than risk broadcasting a tx the wallet can't afford. */
export async function assertStellarGasFloor(): Promise<void> {
  const account = getCctpStellarAccount();
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const onchainAccount = await server.getAccount(account.publicKey());
  const horizonBalance = await fetch(
    `${CCTP_CONFIG.stellarRpcUrl.includes("testnet") ? "https://horizon-testnet.stellar.org" : "https://horizon.stellar.org"}/accounts/${account.publicKey()}`,
  ).then((r) => r.json());
  const nativeBalance = horizonBalance?.balances?.find(
    (b: any) => b.asset_type === "native",
  );
  const xlmBalance = parseFloat(nativeBalance?.balance ?? "0");
  const floor = parseFloat(process.env.CCTP_STELLAR_MIN_GAS_XLM || "2");
  if (xlmBalance < floor) {
    throw new CctpGasError(
      `CCTP Stellar hot wallet XLM balance ${xlmBalance} below floor ${floor}; refusing to submit`,
    );
  }
  // onchainAccount is fetched to fail fast if the account doesn't exist/isn't funded yet.
  void onchainAccount;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `stellar-hot-wallet.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cctp/stellar-hot-wallet.ts
git commit -m "feat(cctp): add new Stellar hot wallet for onramp mint-and-forward"
```

---

## Task 8: Stellar-side CCTP calls — offramp burn (with approve-if-needed)

**Files:**
- Create: `src/lib/cctp/stellar-cctp.ts`
- Test: `src/lib/cctp/stellar-cctp.test.ts`

**Interfaces:**
- Consumes: `CCTP_CONFIG`, `CCTP_DOMAIN`, `FINALITY_THRESHOLD`, `STELLAR_USDC_DECIMALS` (Task 2),
  `evmAddressToScvBytes32`, `zeroBytes32Scval` (Task 3).
- Produces: `checkStellarUsdcAllowance(owner: string): Promise<bigint>`,
  `buildApproveUsdcTx(params): Promise<string>` (unsigned XDR),
  `buildStellarBurnTx(params): Promise<string>` (unsigned XDR).
- Consumed by: Task 13 (offramp `build-tx` route).

This mirrors `src/lib/offramp/adapters/soroban-tx-builder.ts`'s existing simulate-and-assemble
pattern exactly (same project SDK, same reason: Allbridge/Circle-supplied unsigned tx skeletons
aren't submission-ready without our own RPC's resource fee data) — here we build the operation
ourselves from scratch instead of re-assembling one handed to us, but the simulate → bump fee →
assemble tail is identical code, reused as a local helper.

- [ ] **Step 1: Write the failing test**

Only pure amount-conversion logic is unit-tested; the Soroban simulate/assemble calls need a live
RPC and are verified in Task 21.

```ts
// src/lib/cctp/stellar-cctp.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { usdcFloatToStellarInt } from "./stellar-cctp";

test("usdcFloatToStellarInt converts using 7 decimals", () => {
  assert.equal(usdcFloatToStellarInt("1"), 10_000_000n);
  assert.equal(usdcFloatToStellarInt("0.5"), 5_000_000n);
  assert.equal(usdcFloatToStellarInt("12.3456789"), 123456789n);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./stellar-cctp` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/stellar-cctp.ts
import * as StellarSdk from "@stellar/stellar-sdk";
import { xdr } from "@stellar/stellar-sdk";
import {
  CCTP_CONFIG,
  CCTP_DOMAIN,
  FINALITY_THRESHOLD,
  STELLAR_USDC_DECIMALS,
} from "./constants";
import { evmAddressToScvBytes32, zeroBytes32Scval } from "./address-encoding";

const SEND_TX_TIMEOUT_SEC = 180;
const AUTH_EXPIRATION_LEDGER_BUMP = 500;

export function usdcFloatToStellarInt(amount: string): bigint {
  const [intPart, fracPart = ""] = amount.split(".");
  const frac = fracPart.padEnd(STELLAR_USDC_DECIMALS, "0").slice(0, STELLAR_USDC_DECIMALS);
  return (
    BigInt(intPart || "0") * BigInt(10) ** BigInt(STELLAR_USDC_DECIMALS) +
    BigInt(frac || "0")
  );
}

/**
 * Simulate, bump fee, and assemble a single-operation Soroban transaction —
 * identical tail logic to soroban-tx-builder.ts's buildSwapAndBridgeTx (kept
 * as a local copy rather than a cross-import so this module has zero
 * dependency on the Allbridge-era file, consistent with the "no Allbridge
 * dependency for bridging" cutover goal).
 */
async function buildAndAssemble(
  server: StellarSdk.rpc.Server,
  sourceAccount: StellarSdk.Account,
  operation: xdr.Operation,
): Promise<string> {
  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: CCTP_CONFIG.stellarNetworkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(SEND_TX_TIMEOUT_SEC)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${(simResult as any).error}`);
  }
  const simSuccess = simResult as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

  if (simSuccess.result?.auth) {
    const desiredExpiration = simSuccess.latestLedger + AUTH_EXPIRATION_LEDGER_BUMP;
    for (const authEntry of simSuccess.result.auth) {
      const creds = authEntry.credentials();
      if (creds.switch().name === "sorobanCredentialsAddress") {
        creds.address().signatureExpirationLedger(desiredExpiration);
      }
    }
  }

  const originalFee = parseInt(tx.fee, 10);
  const simMinFee = parseInt((simSuccess as any).minResourceFee ?? "0", 10);
  const targetFee = Math.ceil((originalFee + simMinFee) * 1.5);
  const preAssemblyFee = Math.max(targetFee - simMinFee, originalFee);
  (tx as any)._fee = preAssemblyFee.toString();

  const finalTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();
  return finalTx.toXDR();
}

/** Current allowance the user's account has granted TokenMessengerMinter, in Stellar subunits. */
export async function checkStellarUsdcAllowance(owner: string): Promise<bigint> {
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const contract = new StellarSdk.Contract(CCTP_CONFIG.stellarUsdc);
  const account = await server.getAccount(owner);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: CCTP_CONFIG.stellarNetworkPassphrase,
  })
    .addOperation(
      contract.call(
        "allowance",
        new StellarSdk.Address(owner).toScVal(),
        new StellarSdk.Address(CCTP_CONFIG.stellarTokenMessengerMinter).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim)) {
    throw new Error(`allowance simulation failed: ${(sim as any).error}`);
  }
  const result = (sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result?.retval) return 0n;
  return StellarSdk.scValToNative(result.retval) as bigint;
}

/** Unsigned approve tx (only needed the first time, or after allowance is exhausted). */
export async function buildApproveUsdcTx(params: {
  owner: string;
  amount: bigint; // approve at least this much, in Stellar subunits
}): Promise<string> {
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const account = await server.getAccount(params.owner);
  const latestLedger = await server.getLatestLedger();
  const expirationLedger = latestLedger.sequence + 100_000;

  const contract = new StellarSdk.Contract(CCTP_CONFIG.stellarUsdc);
  const operation = contract.call(
    "approve",
    new StellarSdk.Address(params.owner).toScVal(),
    new StellarSdk.Address(CCTP_CONFIG.stellarTokenMessengerMinter).toScVal(),
    StellarSdk.nativeToScVal(params.amount, { type: "i128" }),
    StellarSdk.nativeToScVal(expirationLedger, { type: "u32" }),
  );
  return buildAndAssemble(server, account, operation);
}

/**
 * Unsigned `deposit_for_burn` tx — offramp, Stellar source, Base destination.
 * No hook needed: Base recipients are plain EOAs, not subject to Stellar's
 * "mintRecipient must be a contract" rule (that only applies when Stellar is
 * the *destination*, handled separately for onramp in base-cctp.ts).
 */
export async function buildStellarBurnTx(params: {
  owner: string;
  amountFloat: string;
  destinationEvmAddress: string; // Paycrest's settlement address on Base
  maxFeeStellarInt: bigint;
  fast?: boolean; // default true (Fast Transfer)
}): Promise<string> {
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const account = await server.getAccount(params.owner);

  const contract = new StellarSdk.Contract(CCTP_CONFIG.stellarTokenMessengerMinter);
  const operation = contract.call(
    "deposit_for_burn",
    new StellarSdk.Address(params.owner).toScVal(),
    StellarSdk.nativeToScVal(usdcFloatToStellarInt(params.amountFloat), { type: "i128" }),
    StellarSdk.nativeToScVal(CCTP_DOMAIN.base, { type: "u32" }),
    evmAddressToScvBytes32(params.destinationEvmAddress),
    new StellarSdk.Address(CCTP_CONFIG.stellarUsdc).toScVal(),
    zeroBytes32Scval(), // destination_caller — anyone may call receiveMessage
    StellarSdk.nativeToScVal(params.maxFeeStellarInt, { type: "i128" }),
    StellarSdk.nativeToScVal(
      params.fast === false ? FINALITY_THRESHOLD.standard : FINALITY_THRESHOLD.fast,
      { type: "u32" },
    ),
  );
  return buildAndAssemble(server, account, operation);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/stellar-cctp.ts src/lib/cctp/stellar-cctp.test.ts
git commit -m "feat(cctp): add Stellar-side offramp burn + approve tx builders"
```

---

## Task 9: Stellar-side CCTP calls — onramp mint-and-forward

**Files:**
- Modify: `src/lib/cctp/stellar-cctp.ts`

**Interfaces:**
- Consumes: `getCctpStellarAccount`, `assertStellarGasFloor` (Task 7).
- Produces: `submitMintAndForward(params): Promise<string>` (returns tx hash).
- Consumed by: Task 12 (shared advance function).

- [ ] **Step 1: Write the implementation**

Append to `src/lib/cctp/stellar-cctp.ts`:

```ts
import { getCctpStellarAccount, assertStellarGasFloor } from "./stellar-hot-wallet";

/**
 * Server-signed: submits `mint_and_forward` on the Stellar CctpForwarder for
 * an onramp transfer. Atomic per Circle's docs — mints to the forwarder and
 * pays the real recipient in one Soroban invocation, so there's no
 * partial-mint-but-unforwarded state to handle.
 */
export async function submitMintAndForward(params: {
  messageHex: string; // 0x-prefixed
  attestationHex: string; // 0x-prefixed
}): Promise<string> {
  await assertStellarGasFloor();
  const keypair = getCctpStellarAccount();
  const server = new StellarSdk.rpc.Server(CCTP_CONFIG.stellarRpcUrl);
  const account = await server.getAccount(keypair.publicKey());

  const contract = new StellarSdk.Contract(CCTP_CONFIG.stellarCctpForwarder);
  const operation = contract.call(
    "mint_and_forward",
    xdr.ScVal.scvBytes(Buffer.from(params.messageHex.replace(/^0x/i, ""), "hex")),
    xdr.ScVal.scvBytes(Buffer.from(params.attestationHex.replace(/^0x/i, ""), "hex")),
  );

  const unsignedXdr = await buildAndAssemble(server, account, operation);
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    unsignedXdr,
    CCTP_CONFIG.stellarNetworkPassphrase,
  ) as StellarSdk.Transaction;
  tx.sign(keypair);

  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    throw new Error(`mint_and_forward send failed: ${JSON.stringify(sendResult)}`);
  }
  return sendResult.hash;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cctp/stellar-cctp.ts
git commit -m "feat(cctp): add server-signed mint_and_forward submission for onramp"
```

---

## Task 10: Base-side CCTP calls — onramp burn + offramp mint

**Files:**
- Create: `src/lib/cctp/base-cctp.ts`
- Test: `src/lib/cctp/base-cctp.test.ts`

**Interfaces:**
- Consumes: `CCTP_CONFIG`, `CCTP_DOMAIN`, `FINALITY_THRESHOLD`, `BASE_USDC_DECIMALS` (Task 2),
  `contractStrkeyToBytes32Hex`, `buildForwarderHookData` (Task 3).
- Produces: `usdcFloatToBaseInt(amount): bigint`,
  `submitBaseBurnWithHook(params): Promise<string>` (onramp burn, returns tx hash),
  `submitBaseMint(params): Promise<string>` (offramp mint, returns tx hash).
- Consumed by: Task 12 (shared advance function), Task 19 (onramp integration).

Reuses `src/lib/onramp/base-bridge.ts`'s existing `getAccount()`/`getClients()`/gas-floor pattern
(same env vars: `ONRAMP_HOT_WALLET_PRIVATE_KEY`, `BASE_RPC_URL`, `ONRAMP_MIN_GAS_ETH`) — no new
Base secret needed, this wallet just gains a new capability.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cctp/base-cctp.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { usdcFloatToBaseInt } from "./base-cctp";

test("usdcFloatToBaseInt converts using 6 decimals", () => {
  assert.equal(usdcFloatToBaseInt("1"), 1_000_000n);
  assert.equal(usdcFloatToBaseInt("0.5"), 500_000n);
  assert.equal(usdcFloatToBaseInt("12.345678"), 12_345_678n);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./base-cctp` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/base-cctp.ts
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  CCTP_CONFIG,
  CCTP_DOMAIN,
  CCTP_NETWORK,
  FINALITY_THRESHOLD,
  BASE_USDC_DECIMALS,
} from "./constants";
import {
  contractStrkeyToBytes32Hex,
  buildForwarderHookData,
} from "./address-encoding";

export class CctpBaseGasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpBaseGasError";
  }
}

export function usdcFloatToBaseInt(amount: string): bigint {
  const [intPart, fracPart = ""] = amount.split(".");
  const frac = fracPart.padEnd(BASE_USDC_DECIMALS, "0").slice(0, BASE_USDC_DECIMALS);
  return (
    BigInt(intPart || "0") * BigInt(10) ** BigInt(BASE_USDC_DECIMALS) + BigInt(frac || "0")
  );
}

function getAccount() {
  const pk = process.env.ONRAMP_HOT_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("ONRAMP_HOT_WALLET_PRIVATE_KEY not configured");
  const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(normalized);
}

function getClients() {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error("BASE_RPC_URL not configured");
  const account = getAccount();
  const chain = CCTP_NETWORK === "testnet" ? baseSepolia : base;
  const transport = http(rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

async function assertBaseGasFloor(publicClient: ReturnType<typeof getClients>["publicClient"], address: Hex) {
  const floor = parseEther(process.env.ONRAMP_MIN_GAS_ETH || "0.0005");
  const balance = await publicClient.getBalance({ address });
  if (balance < floor) {
    throw new CctpBaseGasError(
      `Base hot wallet ETH balance ${balance} below floor ${floor}; refusing to submit`,
    );
  }
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const DEPOSIT_FOR_BURN_WITH_HOOK_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const RECEIVE_MESSAGE_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Onramp burn: Base source, Stellar destination. Always uses the CctpForwarder
 * hook pattern — TokenMessengerMinter treats `mintRecipient` as a contract on
 * Stellar, so `mintRecipient` and `destinationCaller` are BOTH the Stellar
 * CctpForwarder, with the real user's G-address carried in hookData. Getting
 * mintRecipient/destinationCaller wrong here permanently strands funds
 * (per Circle's own docs warning) — do not "simplify" this away.
 */
export async function submitBaseBurnWithHook(params: {
  amountFloat: string;
  forwardRecipientStrkey: string; // real Stellar user address
  maxFeeBaseInt: bigint;
  fast?: boolean;
}): Promise<string> {
  const { account, publicClient, walletClient } = getClients();
  await assertBaseGasFloor(publicClient, account.address);

  const amount = usdcFloatToBaseInt(params.amountFloat);
  const forwarderBytes32 = contractStrkeyToBytes32Hex(CCTP_CONFIG.stellarCctpForwarder);
  const hookData = buildForwarderHookData(params.forwardRecipientStrkey);

  // Approve if needed (mirrors base-bridge.ts's existing allowance-check pattern).
  const allowance = await publicClient.readContract({
    address: CCTP_CONFIG.baseUsdc,
    abi: [
      {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "allowance",
    args: [account.address, CCTP_CONFIG.baseTokenMessengerV2],
  });
  if (allowance < amount) {
    const approveTx = await walletClient.sendTransaction({
      to: CCTP_CONFIG.baseUsdc,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [CCTP_CONFIG.baseTokenMessengerV2, amount],
      }),
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const burnTx = await walletClient.sendTransaction({
    to: CCTP_CONFIG.baseTokenMessengerV2,
    data: encodeFunctionData({
      abi: DEPOSIT_FOR_BURN_WITH_HOOK_ABI,
      functionName: "depositForBurnWithHook",
      args: [
        amount,
        CCTP_DOMAIN.stellar,
        forwarderBytes32,
        CCTP_CONFIG.baseUsdc,
        forwarderBytes32, // destinationCaller = same forwarder
        params.maxFeeBaseInt,
        params.fast === false ? FINALITY_THRESHOLD.standard : FINALITY_THRESHOLD.fast,
        hookData,
      ],
    }),
  });
  await publicClient.waitForTransactionReceipt({ hash: burnTx });
  return burnTx;
}

/**
 * Offramp mint: submits `receiveMessage` on Base's MessageTransmitterV2, gas
 * paid by our Base hot wallet. Permissionless — mints straight to whatever
 * mintRecipient was encoded at burn time (Paycrest's settlementAddress), not
 * to our wallet.
 */
export async function submitBaseMint(params: {
  messageHex: string;
  attestationHex: string;
}): Promise<string> {
  const { account, publicClient, walletClient } = getClients();
  await assertBaseGasFloor(publicClient, account.address);

  const tx = await walletClient.sendTransaction({
    to: CCTP_CONFIG.baseMessageTransmitterV2,
    data: encodeFunctionData({
      abi: RECEIVE_MESSAGE_ABI,
      functionName: "receiveMessage",
      args: [params.messageHex as Hex, params.attestationHex as Hex],
    }),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/base-cctp.ts src/lib/cctp/base-cctp.test.ts
git commit -m "feat(cctp): add Base-side onramp burn + offramp mint submitters"
```

---

## Task 11: CCTP transfer store

**Files:**
- Create: `src/lib/cctp/cctp-store.ts`
- Test: `src/lib/cctp/cctp-store.test.ts`

**Interfaces:**
- Produces: `CctpTransferRecord` type, `createCctpTransfer(record)`, `getCctpTransfer(id)`,
  `updateCctpTransfer(id, patch)`, `addPendingTransfer(id)`, `removePendingTransfer(id)`,
  `listPendingTransfers(): Promise<string[]>`.
- Consumed by: Task 12 (advance function), Task 13/14/19/20 (integration).

Directly mirrors `src/lib/onramp/onramp-store.ts`'s existing Redis pattern (TTL'd record + a
pending-ids set for the sweep), same library, same idioms.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cctp/cctp-store.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_RANK } from "./cctp-store";

test("status rank is monotonically increasing through the happy path", () => {
  assert.ok(STATUS_RANK.burned < STATUS_RANK.attesting);
  assert.ok(STATUS_RANK.attesting < STATUS_RANK.attested);
  assert.ok(STATUS_RANK.attested < STATUS_RANK.minting);
  assert.ok(STATUS_RANK.minting < STATUS_RANK.completed);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./cctp-store` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cctp/cctp-store.ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TTL_SECONDS = 7 * 24 * 60 * 60;
const key = (id: string) => `cctp:transfer:${id}`;
const PENDING_KEY = "cctp:pending-transfers";

export type CctpStatus =
  | "burned"
  | "attesting"
  | "attested"
  | "minting"
  | "completed"
  | "failed";

export const STATUS_RANK: Record<CctpStatus, number> = {
  burned: 0,
  attesting: 1,
  attested: 2,
  minting: 3,
  completed: 4,
  failed: 4, // terminal, same rank as completed — either ends progression
};

export interface CctpTransferRecord {
  id: string;
  direction: "offramp" | "onramp";
  sourceDomain: number;
  destDomain: number;
  burnTxHash: string;
  mintRecipient: string;
  status: CctpStatus;
  attestationMessage?: string;
  attestationSignature?: string;
  mintTxHash?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  paycrestOrderId?: string;
}

export async function createCctpTransfer(
  record: Omit<CctpTransferRecord, "createdAt" | "updatedAt" | "attempts">,
): Promise<CctpTransferRecord> {
  const now = Date.now();
  const full: CctpTransferRecord = { ...record, attempts: 0, createdAt: now, updatedAt: now };
  await redis.set(key(record.id), full, { ex: TTL_SECONDS });
  await addPendingTransfer(record.id);
  return full;
}

export async function getCctpTransfer(id: string): Promise<CctpTransferRecord | null> {
  return (await redis.get<CctpTransferRecord>(key(id))) ?? null;
}

export async function updateCctpTransfer(
  id: string,
  patch: Partial<Omit<CctpTransferRecord, "id" | "createdAt">>,
): Promise<CctpTransferRecord | null> {
  const existing = await getCctpTransfer(id);
  if (!existing) return null;

  const merged: CctpTransferRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await redis.set(key(id), merged, { ex: TTL_SECONDS });
  if (merged.status === "completed" || merged.status === "failed") {
    await removePendingTransfer(id);
  }
  return merged;
}

export async function addPendingTransfer(id: string): Promise<void> {
  await redis.sadd(PENDING_KEY, id);
}

export async function removePendingTransfer(id: string): Promise<void> {
  await redis.srem(PENDING_KEY, id);
}

export async function listPendingTransfers(): Promise<string[]> {
  return (await redis.smembers(PENDING_KEY)) ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cctp/cctp-store.ts src/lib/cctp/cctp-store.test.ts
git commit -m "feat(cctp): add Redis-backed CCTP transfer store"
```

---

## Task 12: Shared advance function

**Files:**
- Create: `src/lib/cctp/advance.ts`

**Interfaces:**
- Consumes: `getCctpTransfer`, `updateCctpTransfer` (Task 11), `fetchAttestation`, `reattest`
  (Task 6), `submitBaseMint` (Task 10), `submitMintAndForward` (Task 9).
- Produces: `advanceCctpTransfer(id: string): Promise<CctpStatus>`.
- Consumed by: Task 16 (offramp SSE stream), Task 20 (onramp SSE stream + daily cron backstop).

- [ ] **Step 1: Write the implementation**

Direction-agnostic by design — both SSE routes and the cron backstop call this one function per
pending id; it reads `record.direction` to decide which chain's mint submitter to call.

```ts
// src/lib/cctp/advance.ts
import { getCctpTransfer, updateCctpTransfer, type CctpStatus } from "./cctp-store";
import { fetchAttestation, reattest } from "./iris-client";
import { submitBaseMint } from "./base-cctp";
import { submitMintAndForward } from "./stellar-cctp";

const MAX_ATTEMPTS = 20;

/**
 * Advances one CCTP transfer by whatever it's currently waiting on. Safe to
 * call repeatedly/concurrently for the same id — each step is a Redis
 * read-modify-write, and re-submitting a mint for an already-processed nonce
 * fails harmlessly onchain (CCTP nonces are single-use) rather than
 * double-minting.
 */
export async function advanceCctpTransfer(id: string): Promise<CctpStatus> {
  const record = await getCctpTransfer(id);
  if (!record) throw new Error(`No CCTP transfer record for id ${id}`);
  if (record.status === "completed" || record.status === "failed") {
    return record.status;
  }

  try {
    if (record.status === "burned" || record.status === "attesting") {
      const attestation = await fetchAttestation({
        sourceDomain: record.sourceDomain,
        transactionHash: record.burnTxHash,
      });
      if (!attestation) {
        await updateCctpTransfer(id, {
          status: "attesting",
          attempts: record.attempts + 1,
        });
        return "attesting";
      }
      await updateCctpTransfer(id, {
        status: "attested",
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
      });
      return "attested";
    }

    if (record.status === "attested") {
      if (!record.attestationMessage || !record.attestationSignature) {
        throw new Error("attested status but attestation fields missing");
      }
      const mintTxHash =
        record.direction === "offramp"
          ? await submitBaseMint({
              messageHex: record.attestationMessage,
              attestationHex: record.attestationSignature,
            })
          : await submitMintAndForward({
              messageHex: record.attestationMessage,
              attestationHex: record.attestationSignature,
            });
      await updateCctpTransfer(id, { status: "minting", mintTxHash });
      return "minting";
    }

    if (record.status === "minting") {
      // Mint tx was submitted and awaited inside the submitter itself
      // (submitBaseMint/submitMintAndForward both wait for confirmation
      // before returning), so reaching this state on a later tick means the
      // previous tick's submission is done — mark complete.
      await updateCctpTransfer(id, { status: "completed" });
      return "completed";
    }

    return record.status;
  } catch (error: any) {
    const attempts = record.attempts + 1;
    const isExpiredAttestation =
      typeof error?.message === "string" && error.message.includes("expired");
    if (isExpiredAttestation && record.attestationMessage) {
      try {
        await reattest(record.attestationMessage);
        await updateCctpTransfer(id, {
          status: "attesting",
          attestationMessage: undefined,
          attestationSignature: undefined,
          attempts,
        });
        return "attesting";
      } catch {
        // fall through to generic failure handling below
      }
    }
    await updateCctpTransfer(id, {
      attempts,
      lastError: error?.message || String(error),
      status: attempts >= MAX_ATTEMPTS ? "failed" : record.status,
    });
    return attempts >= MAX_ATTEMPTS ? "failed" : record.status;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cctp/advance.ts
git commit -m "feat(cctp): add shared direction-agnostic transfer-advance function"
```

---

## Task 13: Offramp — rewrite `build-tx` route (allowance-aware, real fee quote)

**Files:**
- Modify: `src/app/api/offramp/bridge/build-tx/route.ts`

**Interfaces:**
- Consumes: `checkStellarUsdcAllowance`, `buildApproveUsdcTx`, `buildStellarBurnTx`,
  `usdcFloatToStellarInt` (Task 8), `getBurnFeeQuote` (Task 6), `CCTP_DOMAIN` (Task 2).
- Produces: response shape `{ needsApproval: true, approveXdr } | { needsApproval: false, xdr, maxFeeFloat }`.

The client (Task 17) checks `needsApproval`: if true, it submits `approveXdr` via the existing
`submit-soroban` route, waits for confirmation, then calls this route again (now allowance is
sufficient) to get the actual burn `xdr`.

- [ ] **Step 1: Replace the route**

```ts
// src/app/api/offramp/bridge/build-tx/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  checkStellarUsdcAllowance,
  buildApproveUsdcTx,
  buildStellarBurnTx,
  usdcFloatToStellarInt,
} from "@/lib/cctp/stellar-cctp";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN } from "@/lib/cctp/constants";
import {
  validateAmount,
  validateAddress,
} from "@/lib/offramp/utils/validation";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, fromAddress, toAddress } = body;

    if (!validateAmount(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!validateAddress(fromAddress, "stellar")) {
      return NextResponse.json({ error: "Invalid Stellar address" }, { status: 400 });
    }
    if (!validateAddress(toAddress, "base")) {
      return NextResponse.json({ error: "Invalid Base address" }, { status: 400 });
    }

    const amountInt = usdcFloatToStellarInt(amount);

    const allowance = await checkStellarUsdcAllowance(fromAddress);
    if (allowance < amountInt) {
      // Approve a generous headroom so repeat offramps skip this step —
      // matches standard "approve once" dApp UX. 1000 USDC in Stellar subunits.
      const approveAmount = amountInt > 10_000_000_000n ? amountInt * 2n : 10_000_000_000n;
      const approveXdr = await buildApproveUsdcTx({
        owner: fromAddress,
        amount: approveAmount,
      });
      return NextResponse.json({ needsApproval: true, approveXdr });
    }

    const feeQuote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    const maxFeeStellarInt = BigInt(feeQuote.minimumFee);

    const xdr = await buildStellarBurnTx({
      owner: fromAddress,
      amountFloat: amount,
      destinationEvmAddress: toAddress,
      maxFeeStellarInt,
    });

    return NextResponse.json({
      needsApproval: false,
      xdr,
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
    } else if (msg.includes("contract call failed") && msg.includes("transfer")) {
      userMessage =
        "A token transfer in the bridge contract failed during simulation. " +
        "This usually means insufficient balance for the amount + fees.";
    }

    return NextResponse.json(
      {
        error: userMessage,
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors in this file (unrelated pre-existing errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/offramp/bridge/build-tx/route.ts
git commit -m "feat(cctp): rewrite offramp build-tx for CCTP (allowance-aware, real fee quote)"
```

---

## Task 14: Offramp — new register-transfer route

**Files:**
- Create: `src/app/api/offramp/bridge/register-transfer/route.ts`

**Interfaces:**
- Consumes: `createCctpTransfer` (Task 11), `recordLedgerEntry` (Task 4), `CCTP_DOMAIN` (Task 2).
- Produces: `POST /api/offramp/bridge/register-transfer` — called by the client right after the
  burn tx is confirmed via `submit-soroban`.

Deliberately separate from `submit-soroban` (generic, reused route — see Global Constraints) and
from `build-tx` (which only builds, doesn't know the tx actually landed).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/offramp/bridge/register-transfer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createCctpTransfer } from "@/lib/cctp/cctp-store";
import { recordLedgerEntry } from "@/lib/ledger/funds-ledger";
import { CCTP_DOMAIN } from "@/lib/cctp/constants";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { burnTxHash, mintRecipient, amount, paycrestOrderId } = body;

    if (!burnTxHash || !mintRecipient || !amount) {
      return NextResponse.json(
        { error: "burnTxHash, mintRecipient, and amount are required" },
        { status: 400 },
      );
    }

    const id = randomUUID();
    const record = await createCctpTransfer({
      id,
      direction: "offramp",
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
      burnTxHash,
      mintRecipient,
      status: "burned",
      paycrestOrderId,
    });

    await recordLedgerEntry({
      direction: "offramp",
      chain: "stellar",
      asset: "USDC",
      amount,
      txHash: burnTxHash,
      orderId: paycrestOrderId,
    });

    return NextResponse.json({ transferId: record.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to register transfer" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/offramp/bridge/register-transfer/route.ts
git commit -m "feat(cctp): add offramp register-transfer route (creates record + ledger entry)"
```

---

## Task 15: Offramp — rewrite `gas-fee-options` and `quote` routes

**Files:**
- Modify: `src/app/api/offramp/bridge/gas-fee-options/route.ts`
- Modify: `src/app/api/offramp/quote/route.ts`

**Interfaces:**
- Consumes: `getBurnFeeQuote` (Task 6), `CCTP_DOMAIN`, `STELLAR_USDC_DECIMALS` (Task 2).
- Produces: `{ feeOptions: { fee: { int: string; float: string } } }` — replaces the old
  `{ native, stablecoin }` shape (Task 17's FormCard rewrite consumes the new shape).

- [ ] **Step 1: Rewrite `gas-fee-options/route.ts`**

```ts
// src/app/api/offramp/bridge/gas-fee-options/route.ts
import { NextResponse } from "next/server";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, STELLAR_USDC_DECIMALS } from "@/lib/cctp/constants";

function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

export async function GET() {
  try {
    const quote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    return NextResponse.json({
      feeOptions: {
        fee: {
          int: quote.minimumFee,
          float: intToFloat(quote.minimumFee, STELLAR_USDC_DECIMALS),
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch gas fee options" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Rewrite the quote route's bridge-fee calculation**

`src/app/api/offramp/quote/route.ts` currently branches on `feePaymentMethod` (Allbridge Next
offered separate native/stablecoin fee options) and calls `getNextQuote` for a swap-adjusted
`amountOut`. CCTP is a 1:1 burn-and-mint with no swap spread — there's just one real fee,
always deducted from the source amount, so the branch and the swap-quote call both go away.

Replace lines 1-60 (everything from the imports through the `amountAfterBridge` calculation) with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { PaycrestAdapter } from "@/lib/offramp/adapters/paycrest-adapter";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, STELLAR_USDC_DECIMALS } from "@/lib/cctp/constants";
import {
  validateAmount,
  validateToken,
  validateCurrency,
} from "@/lib/offramp/utils/validation";

function intToFloat(amountInt: string, decimals: number): string {
  const value = BigInt(amountInt);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fracDigits = (value % divisor).toString().padStart(decimals, "0");
  const fracTrimmed = fracDigits.replace(/0+$/, "");
  return fracTrimmed ? `${whole}.${fracTrimmed}` : whole.toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount, token, currency, network, provider_id } = body;

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

    // CCTP burns 1:1 minus a flat fee (no swap spread) — always deducted from
    // the source amount, unlike Allbridge Next's native/stablecoin choice.
    const feeQuote = await getBurnFeeQuote({
      sourceDomain: CCTP_DOMAIN.stellar,
      destDomain: CCTP_DOMAIN.base,
    });
    const bridgeFeeFloat = parseFloat(
      intToFloat(feeQuote.minimumFee, STELLAR_USDC_DECIMALS),
    );
    const amountAfterBridge = parseFloat(amount) - bridgeFeeFloat;
    if (amountAfterBridge <= 0) {
      return NextResponse.json(
        { error: "Amount is too small to cover the bridge fee" },
        { status: 400 },
      );
    }
    const receiveAmount = amountAfterBridge.toFixed(6); // Base USDC, 6 decimals

    // Paycrest: convert post-bridge USDC amount to fiat rate/output
    const rate = await paycrest.getRate(token, receiveAmount, currency, {
      network: network || "base",
      providerId: provider_id,
    });
```

The rest of the route (platform fee calculation, response shape) is unchanged — it already reads
`amountAfterBridge`/`receiveAmount`/`rate` by name, which this rewrite still produces. The one
remaining line to fix is the `estimatedTime` calculation (previously
`bridgeQuote.estimatedTime * 1000 + 2 * 60 * 1000`, using Allbridge Next's own per-quote estimate)
— CCTP's Iris fee-quote endpoint doesn't return a time estimate, so replace it with a fixed
Fast-Transfer-target constant:

```ts
    // CCTP Fast Transfer targets ~8-20s attestation (Circle's published range,
    // not a per-quote estimate — Iris's fee endpoint doesn't return one) + the
    // existing ~2min Paycrest payout buffer.
    const estimatedTime = 30 * 1000 + 2 * 60 * 1000;
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, then:

```bash
curl -s http://localhost:3000/api/offramp/bridge/gas-fee-options
```

Expected: `{"feeOptions":{"fee":{"int":"...","float":"..."}}}` with real non-placeholder numbers
(assuming Iris's sandbox/mainnet fee endpoint is reachable — if `CCTP_NETWORK` isn't set, this
hits mainnet Iris for a real quote).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/offramp/bridge/gas-fee-options/route.ts src/app/api/offramp/quote/route.ts
git commit -m "feat(cctp): swap offramp fee display to real Iris fee quotes"
```

---

## Task 16: Offramp — new SSE stream route

**Files:**
- Create: `src/app/api/offramp/bridge/stream/[transferId]/route.ts`

**Interfaces:**
- Consumes: `getCctpTransfer` (Task 11), `advanceCctpTransfer` (Task 12).
- Produces: `GET /api/offramp/bridge/stream/[transferId]` — SSE stream.

Directly mirrors `src/app/api/onramp/stream/[orderId]/route.ts`'s existing shape and reasoning
(documented in that file's own comment about Vercel Hobby's daily-only cron).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/offramp/bridge/stream/[transferId]/route.ts
import { NextRequest } from "next/server";
import { getCctpTransfer, type CctpTransferRecord } from "@/lib/cctp/cctp-store";
import { advanceCctpTransfer } from "@/lib/cctp/advance";

export const runtime = "nodejs";
export const maxDuration = 60;

const POLL_MS = 3000;
const ADVANCE_MS = 8000; // CCTP Fast Transfer targets ~8-20s; check fairly eagerly

/**
 * Streams a CCTP offramp transfer's status to the browser, same pattern as
 * the existing onramp stream (src/app/api/onramp/stream/[orderId]/route.ts):
 * this open-tab path is what drives attest→mint promptly, since this
 * project's Vercel plan only runs cron once a day.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const { transferId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastSerialized = "";
      let lastAdvance = 0;

      const send = (record: CctpTransferRecord) => {
        const payload = {
          id: record.id,
          status: record.status,
          burnTxHash: record.burnTxHash,
          mintTxHash: record.mintTxHash,
          updatedAt: record.updatedAt,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const record = await getCctpTransfer(transferId);
          if (!record) return;

          if (
            (record.status === "burned" ||
              record.status === "attesting" ||
              record.status === "attested" ||
              record.status === "minting") &&
            Date.now() - lastAdvance > ADVANCE_MS
          ) {
            lastAdvance = Date.now();
            try {
              await advanceCctpTransfer(transferId);
            } catch {
              // Advance failed this round — retry next interval.
            }
          }

          const latest = (await getCctpTransfer(transferId)) ?? record;
          const serialized = JSON.stringify(latest);
          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            send(latest);
          }

          if (latest.status === "completed" || latest.status === "failed") {
            close();
          }
        } catch {
          // Transient error — keep the stream open, retry next tick.
        }
      };

      const interval = setInterval(tick, POLL_MS);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/offramp/bridge/stream/[transferId]/route.ts"
git commit -m "feat(cctp): add offramp SSE stream driving attest-to-mint"
```

---

## Task 17: Offramp — update `FormCard.tsx` and the dashboard's submit flow

**Files:**
- Modify: `src/components/FormCard.tsx`
- Modify: `src/components/StellarampDashboard.tsx`

**Interfaces:**
- Consumes: the new `build-tx` response shape (Task 13), `register-transfer` (Task 14), the new
  `stream/[transferId]` route (Task 16), the new `gas-fee-options` shape (Task 15).

- [ ] **Step 1: Simplify the fee display in `FormCard.tsx`**

Remove the `feePaymentMethod` state, the `stablecoinFeeAvailable`/`noSeparateRelayerFee` derived
values, and the two-button "PAY GAS FEE WITH" selector entirely (CCTP has one real fee, not a
native/stablecoin choice). Replace the `GasFeeOptions` interface with:

```ts
export interface GasFeeOptions {
  fee: { int: string; float: string };
}
```

Replace the selector block with a single read-only line:

```tsx
{gasFeeOptions && parseFloat(amount) > 0 && (
  <p className="m-0 text-[0.8rem] text-[var(--muted)]">
    Bridge fee: {parseFloat(gasFeeOptions.fee.float).toFixed(4)} USDC — ~
    {Math.max(0, parseFloat(amount) - parseFloat(gasFeeOptions.fee.float)).toFixed(4)}{" "}
    USDC bridged
  </p>
)}
```

Remove `feePaymentMethod` from the body sent to `/api/offramp/quote` and from the
`onPricingUpdate` payload's dependents.

- [ ] **Step 2: Extract the existing submit-and-confirm logic into a reusable helper**

The current single-burn flow (verified at `StellarampDashboard.tsx:502-611`) inlines "submit
signed XDR to `submit-soroban` → if `PENDING`, poll `/api/offramp/bridge/tx-status/[hash]` every
3s up to 90s → return the confirmed hash or throw." CCTP needs this exact sequence run **twice**
(approve, then burn) instead of once, so extract it into a module-level helper (placed next to
the existing `formatSorobanError` function, around line 77) rather than duplicating it:

```ts
// Module scope, near formatSorobanError (~line 77)
async function submitAndConfirmSoroban(signedXdr: string): Promise<string> {
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
      throw new Error("Submit transaction timed out (15s). Please try again.");
    }
    throw new Error(`Submit transaction network error: ${fetchErr.message}`);
  } finally {
    clearTimeout(submitTimer);
  }

  const submitPayload = await submitResponse.json().catch(() => ({}));
  if (!submitResponse.ok) {
    throw new Error(
      submitPayload?.error ||
        `Soroban transaction error: ${formatSorobanError(submitPayload?.details || submitPayload)}`,
    );
  }
  if (!submitPayload?.hash) {
    throw new Error(`Soroban submit missing hash: ${JSON.stringify(submitPayload)}`);
  }

  const txHash: string = submitPayload.hash;
  if (submitPayload.status === "SUCCESS") return txHash;
  if (submitPayload.status !== "PENDING") {
    throw new Error(
      `Transaction not confirmed (status: ${submitPayload?.status}). ` +
        (submitPayload?.error || "Please try again."),
    );
  }

  const maxPollAttempts = 30; // 30 × 3s = 90s
  for (let i = 0; i < maxPollAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`/api/offramp/bridge/tx-status/${txHash}`);
    const statusData = await statusRes.json().catch(() => ({}));
    if (statusData?.status === "SUCCESS") return txHash;
    if (statusData?.status === "FAILED") {
      throw new Error("Transaction failed on-chain. Your wallet was not debited.");
    }
    // NOT_FOUND — keep polling
  }
  throw new Error(
    "Transaction was not confirmed within 90s. It may have expired. Your wallet was likely not debited.",
  );
}
```

Then replace the existing inline block at lines 506-611 (the `hasSorobanOps` branch's submit +
poll logic) with `stellarTxHash = await submitAndConfirmSoroban(signedXdr);` — same behavior,
now reusable. Leave the classic-tx branch (lines 612-621) untouched.

- [ ] **Step 3: Rewrite the build/sign/submit sequence for CCTP's approve-then-burn**

Replace the existing step-3/4/5 block (building the single Allbridge tx, signing, submitting —
the code shown in Step 2 above, before your edit) with:

```ts
// 3) Build CCTP burn tx — may require an approve step first
setOfframpStep("submitting");
let buildTxPayload = await fetch("/api/offramp/bridge/build-tx", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    amount: tradeData.amount,
    fromAddress: wallet.publicKey,
    toAddress: settlementAddress,
  }),
}).then((r) => r.json());

if (buildTxPayload.needsApproval) {
  setOfframpStep("awaiting-signature");
  const signedApprove = await signTransaction(buildTxPayload.approveXdr);
  setOfframpStep("submitting");
  await submitAndConfirmSoroban(signedApprove);

  // Re-request now that allowance is sufficient.
  buildTxPayload = await fetch("/api/offramp/bridge/build-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: tradeData.amount,
      fromAddress: wallet.publicKey,
      toAddress: settlementAddress,
    }),
  }).then((r) => r.json());
}
if (!buildTxPayload.xdr) {
  throw new Error(buildTxPayload?.error || "Bridge transaction payload missing XDR");
}

// 4) Sign and submit the burn
setOfframpStep("awaiting-signature");
const signedBurn = await signTransaction(buildTxPayload.xdr);
setOfframpStep("submitting");
const stellarTxHash = await submitAndConfirmSoroban(signedBurn);

setTradeState((prev) => ({ ...prev, stellarTxHash, bridgeStatus: "pending" }));

// 5) Register the transfer (creates the CctpTransferRecord + ledger entry)
const { transferId } = await fetch("/api/offramp/bridge/register-transfer", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    burnTxHash: stellarTxHash,
    mintRecipient: settlementAddress,
    amount: tradeData.amount,
    paycrestOrderId: payoutOrderId,
  }),
}).then((r) => r.json());

// 6) Open the SSE stream so attest-to-mint is driven forward while this tab
// is open (fire-and-forget from the UI's perspective — the existing
// Paycrest payout webhook remains the real completion signal, this is only
// for our own operational tracking + the funds ledger already written).
new EventSource(`/api/offramp/bridge/stream/${transferId}`);
```

`signTransaction` is the wallet-signing function already destructured at
`StellarampDashboard.tsx:99` — reused as-is, not a new helper. `settlementAddress` and
`payoutOrderId` are the same in-scope variables the current code already uses (from the Paycrest
order creation step immediately before this block, at lines 444-461).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, connect a Freighter wallet with testnet XLM/USDC (see Task 21 for full testnet
setup), and confirm the two-phase flow (approve prompt on first-ever offramp, then burn prompt)
behaves correctly, and that the fee line shows a real, non-zero USDC amount.

- [ ] **Step 5: Commit**

```bash
git add src/components/FormCard.tsx src/components/StellarampDashboard.tsx
git commit -m "feat(cctp): update offramp UI for CCTP's single fee + approve-then-burn flow"
```

---

## Task 18: Offramp — extend the daily cron backstop

**Files:**
- Modify: `src/app/api/cron/finalize-onramp/route.ts`

**Interfaces:**
- Consumes: `listPendingTransfers`, `advanceCctpTransfer` (Tasks 11-12).

Renaming the route is out of scope (churn without benefit) — it stays named for onramp but now
also sweeps CCTP transfers of both directions, since they share the same daily-backstop need.

- [ ] **Step 1: Extend the sweep**

Add to `src/app/api/cron/finalize-onramp/route.ts`, after the existing onramp sweep loop:

```ts
import { listPendingTransfers } from "@/lib/cctp/cctp-store";
import { advanceCctpTransfer } from "@/lib/cctp/advance";
```

```ts
  const cctpIds = await listPendingTransfers();
  let cctpAdvanced = 0;
  for (const id of cctpIds) {
    try {
      await advanceCctpTransfer(id);
      cctpAdvanced++;
    } catch {
      // Transient error on one transfer shouldn't stop the sweep.
    }
  }
```

Include `cctpChecked: cctpIds.length, cctpAdvanced` in the route's final JSON response, alongside
the existing `checked`/`delivered`/`stillPending` fields.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/finalize-onramp/route.ts
git commit -m "feat(cctp): sweep pending CCTP transfers in the daily backstop cron"
```

---

## Task 19: Onramp — rewrite `base-bridge.ts` for CCTP

**Files:**
- Modify: `src/lib/onramp/base-bridge.ts`

**Interfaces:**
- Consumes: `submitBaseBurnWithHook` (Task 10).
- Produces: `bridgeUsdcBaseToStellar(params)` — same exported name/shape as today, so
  `handle-settlement.ts` doesn't need to change its call site.

- [ ] **Step 1: Replace the Allbridge-SDK body with a CCTP burn**

```ts
// src/lib/onramp/base-bridge.ts
/**
 * Onramp Base→Stellar bridge leg, now via direct CCTP instead of Allbridge
 * Core. After Paycrest settles an onramp order, USDC lands in the platform
 * Base hot wallet; this burns it via CCTP's depositForBurnWithHook, routed
 * through Stellar's CctpForwarder so it lands on the real user's G-address.
 * The mint-and-forward completion on Stellar is driven separately by
 * src/lib/cctp/advance.ts (called from the SSE stream / daily cron), not
 * from here — this function's job ends once the Base burn is confirmed.
 */

import { submitBaseBurnWithHook } from "@/lib/cctp/base-cctp";
import { getBurnFeeQuote } from "@/lib/cctp/iris-client";
import { CCTP_DOMAIN, BASE_USDC_DECIMALS } from "@/lib/cctp/constants";
import { createCctpTransfer } from "@/lib/cctp/cctp-store";
import { randomUUID } from "crypto";
import { CctpBaseGasError } from "@/lib/cctp/base-cctp";

export { CctpBaseGasError as BridgeGasError };

export interface BridgeToStellarResult {
  bridgeTxHash: string;
  sentAmount: string;
  cctpTransferId: string;
}

export async function bridgeUsdcBaseToStellar(params: {
  amount: string; // human USDC amount, e.g. "50.00"
  stellarAddress: string;
}): Promise<BridgeToStellarResult> {
  const feeQuote = await getBurnFeeQuote({
    sourceDomain: CCTP_DOMAIN.base,
    destDomain: CCTP_DOMAIN.stellar,
  });

  const bridgeTxHash = await submitBaseBurnWithHook({
    amountFloat: params.amount,
    forwardRecipientStrkey: params.stellarAddress,
    maxFeeBaseInt: BigInt(feeQuote.minimumFee),
  });

  const cctpTransferId = randomUUID();
  await createCctpTransfer({
    id: cctpTransferId,
    direction: "onramp",
    sourceDomain: CCTP_DOMAIN.base,
    destDomain: CCTP_DOMAIN.stellar,
    burnTxHash: bridgeTxHash,
    mintRecipient: params.stellarAddress,
    status: "burned",
  });

  return { bridgeTxHash, sentAmount: params.amount, cctpTransferId };
}
```

Note: `BASE_USDC_DECIMALS` is imported but only needed if downstream callers need it — if unused
after this edit, remove the import (avoid an unused-import lint failure).

- [ ] **Step 2: Update `handle-settlement.ts` to store the new transfer id**

In `src/lib/onramp/onramp-store.ts`, add an optional field to `OnrampRecord`:

```ts
cctpTransferId?: string; // links to the CctpTransferRecord driving delivery
```

In `src/lib/onramp/handle-settlement.ts`, after the `bridgeUsdcBaseToStellar` call succeeds, store
`result.cctpTransferId` via `updateOnrampOrder(orderId, { bridgeTxHash: result.bridgeTxHash, cctpTransferId: result.cctpTransferId })`
— find the existing post-bridge `updateOnrampOrder` call (around the code shown earlier ending at
line ~80) and add the field to its patch object rather than adding a second call.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors. If `initializeAllbridgeSdk`/`getAllbridgeTokens` imports become unused in
this file, remove them (they're no longer called).

- [ ] **Step 4: Commit**

```bash
git add src/lib/onramp/base-bridge.ts src/lib/onramp/handle-settlement.ts src/lib/onramp/onramp-store.ts
git commit -m "feat(cctp): rewrite onramp Base->Stellar bridge leg for CCTP"
```

---

## Task 20: Onramp — drive CCTP from the existing SSE stream + finalizer

**Files:**
- Modify: `src/app/api/onramp/stream/[orderId]/route.ts`

**Interfaces:**
- Consumes: `advanceCctpTransfer` (Task 12), `getOnrampOrder` (existing).

- [ ] **Step 1: Swap the bridging-phase driver**

In `src/app/api/onramp/stream/[orderId]/route.ts`, replace the `initializeAllbridgeSdk` +
`finalizeOnrampOrder` call inside the `tick` function's `record.status === "bridging"` branch
with:

```ts
import { advanceCctpTransfer } from "@/lib/cctp/advance";
```

```ts
          if (
            record.status === "bridging" &&
            record.cctpTransferId &&
            Date.now() - lastBridgeCheck > BRIDGE_CHECK_MS
          ) {
            lastBridgeCheck = Date.now();
            try {
              const cctpStatus = await advanceCctpTransfer(record.cctpTransferId);
              if (cctpStatus === "completed") {
                await updateOnrampOrder(orderId, {
                  status: "delivered",
                  stellarTxHash: (await getCctpTransfer(record.cctpTransferId))?.mintTxHash,
                });
              } else if (cctpStatus === "failed") {
                await updateOnrampOrder(orderId, {
                  status: "bridge_failed",
                  failureReason: "CCTP transfer failed after max retries",
                });
              }
            } catch {
              // Advance failed this round — retry next interval.
            }
          }
```

Add the needed imports (`getCctpTransfer` from `@/lib/cctp/cctp-store`, `updateOnrampOrder` from
`./onramp-store` if not already imported in this file). Remove the now-unused
`initializeAllbridgeSdk`/`finalizeOnrampOrder`/`sdkPromise` machinery from this file if nothing
else in it still uses them.

- [ ] **Step 2: Extend `finalize-onramp`'s onramp-side sweep too**

`src/lib/onramp/finalize.ts`'s `finalizeOnrampOrder` (called by both the daily cron and, until
this task, the SSE stream) is now unused for the CCTP path — leave the file in place (Allbridge
rollback reference, per Global Constraints) but confirm nothing else still calls it after this
change; if the daily cron (`finalize-onramp/route.ts`) still imports it for the old code path,
that import can stay since Task 18 only added a second, independent CCTP sweep alongside it, not
a replacement.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/onramp/stream/[orderId]/route.ts"
git commit -m "feat(cctp): drive onramp bridging via CCTP advance in the existing SSE stream"
```

---

## Task 21: Testnet end-to-end verification — offramp (Stellar → Base)

**Files:** none (verification only — a throwaway script, not committed).

- [ ] **Step 1: Set up testnet env vars**

Set locally (`.env.local`, not committed): `CCTP_NETWORK=testnet`,
`STELLAR_SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org`,
`BASE_RPC_URL=<a Base Sepolia RPC URL>`, `ONRAMP_HOT_WALLET_PRIVATE_KEY=<a funded Base Sepolia test key>`,
`ONRAMP_HOT_WALLET_ADDRESS=<its address>`.

- [ ] **Step 2: Fund a testnet Stellar account**

Generate a fresh keypair (`node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().publicKey())"`
printed alongside its secret), fund it via `https://friendbot.stellar.org` (testnet XLM), and
establish a USDC trustline + get testnet USDC from
[Circle's testnet faucet](https://faucet.circle.com) for the testnet Stellar USDC asset
(`USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`).

- [ ] **Step 3: Fund the Base Sepolia hot wallet**

Get Base Sepolia ETH (for gas) and testnet USDC (Circle's faucet, Base Sepolia) into the
`ONRAMP_HOT_WALLET_ADDRESS` account — this wallet submits the offramp mint step.

- [ ] **Step 4: Run the app and drive one real offramp**

`npm run dev`, connect the funded testnet Freighter wallet, initiate an offramp for a small amount
(e.g. 1 USDC) to any valid Base Sepolia address as the mock "settlement address" (bypass Paycrest
order creation for this test by calling `build-tx`/`register-transfer` directly with curl if the
full Paycrest sandbox isn't available):

```bash
curl -s -X POST http://localhost:3000/api/offramp/bridge/build-tx \
  -H "Content-Type: application/json" \
  -d '{"amount":"1","fromAddress":"<testnet G-address>","toAddress":"<any Base Sepolia 0x address>"}'
```

- [ ] **Step 5: Confirm funds actually land**

After the approve (if prompted) and burn are signed and submitted, and the SSE stream has had
time to drive attest→mint (should complete within ~30-60s for a Fast Transfer), check the
destination Base Sepolia address's USDC balance on
`https://base-sepolia.blockscout.com/address/<toAddress>` and confirm it increased by the
expected (amount minus fee) — not by trusting the reconstructed flow blind, per this project's
established testing practice.

- [ ] **Step 6: Record the outcome**

No commit needed for this task — it's verification, not code. If any step fails, fix the
relevant task's code and re-run from Step 4.

---

## Task 22: Testnet end-to-end verification — onramp (Base → Stellar)

**Files:** none (verification only).

- [ ] **Step 1: Fund a testnet Stellar recipient**

Generate a second fresh testnet Stellar keypair (this one plays the "end user" receiving funds —
no XLM funding needed beyond a trustline for testnet USDC, since it's a plain recipient, not a
signer, in this leg) and establish its USDC trustline via Friendbot + a trustline-setup script or
Stellar Laboratory.

- [ ] **Step 2: Fund the new CCTP Stellar hot wallet**

Set `CCTP_STELLAR_HOT_WALLET_SECRET` to a fresh testnet keypair's secret, fund its XLM via
Friendbot (this wallet only pays gas for `mint_and_forward`, no USDC needed on it).

- [ ] **Step 3: Simulate a settlement and drive one real onramp**

Call `bridgeUsdcBaseToStellar` directly (temporary script, not committed) with the Base Sepolia
hot wallet (funded with testnet USDC per Task 21 Step 3) and the recipient address from Step 1:

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { bridgeUsdcBaseToStellar } = require('./src/lib/onramp/base-bridge.ts');
bridgeUsdcBaseToStellar({ amount: '1', stellarAddress: '<testnet recipient G-address>' })
  .then(console.log)
  .catch(console.error);
"
```

(Adjust for this project's actual TS execution setup — e.g. via `npx tsx` if plain `node -e`
can't resolve the `.ts` import path aliases; check `tsconfig.json`'s `paths` config first.)

- [ ] **Step 4: Drive the mint-and-forward step**

Since this bypasses the SSE stream (no browser tab open), manually advance the transfer using the
id returned by Step 3:

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { advanceCctpTransfer } = require('./src/lib/cctp/advance.ts');
const id = '<cctpTransferId from Step 3>';
async function poll() {
  const status = await advanceCctpTransfer(id);
  console.log(status);
  if (status !== 'completed' && status !== 'failed') {
    setTimeout(poll, 5000);
  }
}
poll();
"
```

- [ ] **Step 5: Confirm funds actually land**

Check the recipient address's USDC balance on
`https://stellar.expert/explorer/testnet/account/<recipient G-address>` and confirm it increased
by the expected amount.

- [ ] **Step 6: Record the outcome**

No commit needed. If any step fails, fix the relevant task's code and re-run from Step 3.

---

## Self-review notes

Checked against the spec (`docs/superpowers/specs/2026-08-20-cctp-direct-integration-design.md`):

- Full cutover, no live fallback — no dual-path logic added anywhere above (Global Constraints).
- Both directions covered (Tasks 8-9/13-17 offramp, 10/19-20 onramp).
- New Stellar hot wallet (Task 7), reused Base hot wallet (Task 10) — matches spec's secrets
  section.
- SSE-plus-daily-cron relay (Tasks 16, 18, 20) replaces the originally-scoped minute-cron per the
  Vercel Hobby correction.
- Funds ledger (Tasks 4-5, wired into Task 14 for offramp) matches the ledger section added to the
  spec.
- Testnet-first rollout (Tasks 21-22) before the spec's mainnet small-amount verification note —
  the plan stops at testnet; a follow-up mainnet dry run (~1 USDC per direction) should be done
  manually before flipping `CCTP_NETWORK` off testnet in production, same as the spec's rollout
  section states, but isn't written as a plan task since it's a one-time manual action gated on
  all prior tasks passing, not new code.
- Allbridge code explicitly left unwired, not deleted, in every relevant task (Tasks 13, 19).

No placeholders, no "TBD"/"similar to Task N" shortcuts, no undefined-elsewhere types referenced.
Type names (`CctpTransferRecord`, `CctpStatus`, `FundsLedgerEntry`, `CctpAddresses`) are
consistent across every task that touches them.
