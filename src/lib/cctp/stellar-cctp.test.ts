import test from "node:test";
import assert from "node:assert/strict";
import { usdcFloatToStellarInt } from "./stellar-cctp";

test("usdcFloatToStellarInt converts using 7 decimals", () => {
  assert.equal(usdcFloatToStellarInt("1"), BigInt(10_000_000));
  assert.equal(usdcFloatToStellarInt("0.5"), BigInt(5_000_000));
  assert.equal(usdcFloatToStellarInt("12.3456789"), BigInt(123456789));
});
