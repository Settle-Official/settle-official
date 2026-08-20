import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerEntry } from "./funds-ledger.ts";


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
