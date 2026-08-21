import test from "node:test";
import assert from "node:assert/strict";
import { usdcFloatToBaseInt } from "./base-cctp";

test("usdcFloatToBaseInt converts using 6 decimals", () => {
  assert.equal(usdcFloatToBaseInt("1"), BigInt(1_000_000));
  assert.equal(usdcFloatToBaseInt("0.5"), BigInt(500_000));
  assert.equal(usdcFloatToBaseInt("12.345678"), BigInt(12_345_678));
});
