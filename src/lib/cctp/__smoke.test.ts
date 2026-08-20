import test from "node:test";
import assert from "node:assert/strict";

test("node:test runs TypeScript directly", () => {
  const x: number = 1 + 1;
  assert.equal(x, 2);
});
