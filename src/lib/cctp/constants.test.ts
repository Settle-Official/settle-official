import test from "node:test";
import assert from "node:assert/strict";
import { CCTP_DOMAIN, CCTP_CONFIG, STELLAR_USDC_DECIMALS, BASE_USDC_DECIMALS } from "./constants.ts";

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
