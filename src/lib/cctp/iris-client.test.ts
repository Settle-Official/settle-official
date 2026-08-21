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
