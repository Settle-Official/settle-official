import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_RANK, mergeCctpTransfer, type CctpTransferRecord } from "./cctp-store";

test("status rank is monotonically increasing through the happy path", () => {
  assert.ok(STATUS_RANK.burned < STATUS_RANK.attesting);
  assert.ok(STATUS_RANK.attesting < STATUS_RANK.attested);
  assert.ok(STATUS_RANK.attested < STATUS_RANK.minting);
  assert.ok(STATUS_RANK.minting < STATUS_RANK.completed);
});

function fakeRecord(overrides: Partial<CctpTransferRecord> = {}): CctpTransferRecord {
  return {
    id: "tx1",
    direction: "offramp",
    sourceDomain: 27,
    destDomain: 6,
    burnTxHash: "tx1",
    mintRecipient: "0xabc",
    status: "attested",
    attempts: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test("mergeCctpTransfer applies a normal forward-progress patch", () => {
  const existing = fakeRecord({ status: "attested" });
  const merged = mergeCctpTransfer(existing, { status: "minting", mintTxHash: "0xmint" });
  assert.equal(merged.status, "minting");
  assert.equal(merged.mintTxHash, "0xmint");
});

test("mergeCctpTransfer refuses to regress a completed record — the exact bug from the incident", () => {
  // This is the real scenario: a racing, late-finishing failure attempt
  // (computed from a stale in-memory "attested" snapshot) tries to write
  // status: "failed" after another call already advanced the record to
  // "completed". Without this guard, the stale write wins.
  const existing = fakeRecord({ status: "completed", mintTxHash: "0xrealmint" });
  const merged = mergeCctpTransfer(existing, {
    status: "failed",
    lastError: "Execution reverted: Nonce already used",
  });
  assert.equal(merged.status, "completed");
  assert.equal(merged.mintTxHash, "0xrealmint");
  assert.equal(merged.lastError, undefined);
});

test("mergeCctpTransfer also freezes an already-failed record", () => {
  const existing = fakeRecord({ status: "failed", lastError: "first failure" });
  const merged = mergeCctpTransfer(existing, { status: "attesting" });
  assert.equal(merged.status, "failed");
  assert.equal(merged.lastError, "first failure");
});
