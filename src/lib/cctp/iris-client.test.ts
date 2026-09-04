import test from "node:test";
import assert from "node:assert/strict";
import { buildMessagesUrl, buildFeeQuoteUrl, computeAtomicFee } from "./iris-client";

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

test("computeAtomicFee returns zero for a zero bps rate", () => {
  assert.equal(computeAtomicFee(0, BigInt(1_000_000)), BigInt(0));
});

test("computeAtomicFee handles a fractional bps rate without throwing", () => {
  // Reproduces the live incident: Circle's fee API returned
  // {"finalityThreshold":1000,"minimumFee":1.3} for Base->Stellar, and the
  // old code did BigInt(feeQuote.minimumFee) directly — BigInt("1.3") throws
  // "Cannot convert 1.3 to a BigInt", which stranded a real onramp order in
  // bridge_failed. 719590n = 0.71959 USDC at Base's 6 decimals.
  const fee = computeAtomicFee(1.3, BigInt(719590));
  assert.equal(fee, BigInt(94));
});

test("computeAtomicFee rounds up (ceiling division) rather than undercharging", () => {
  // 1 bps of 100 atomic units is exactly 0.01, which must round up to 1, not
  // truncate to 0 — a maxFee below Circle's minimum leaves the burn stuck.
  const fee = computeAtomicFee(1, BigInt(100));
  assert.equal(fee, BigInt(1));
});

test("computeAtomicFee treats NaN/negative rates as zero", () => {
  assert.equal(computeAtomicFee(NaN, BigInt(1_000_000)), BigInt(0));
  assert.equal(computeAtomicFee(-5, BigInt(1_000_000)), BigInt(0));
});
