import test from "node:test";
import assert from "node:assert/strict";
import {
  evmAddressToScvBytes32,
  contractStrkeyToBytes32Hex,
  zeroBytes32Scval,
  buildForwarderHookData,
} from "./address-encoding.ts";

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
  // A real, checksum-valid Stellar public key (Keypair.random()) — an earlier
  // draft of this fixture used a made-up-but-wrong-checksum address and
  // caught exactly the validation bug it was meant to catch.
  const hookData = buildForwarderHookData(
    "GDIGTVLCMYGW5RVRD7NURDG4PNBM2PWS3M3OOYM5Y54SFJ7TWZNNDJPV",
  );
  assert.equal(
    hookData,
    "0x00000000000000000000000000000000000000000000000000000000000000384744494754564c434d5947573552565244374e5552444734504e424d32505753334d334f4f594d3559353453464a3754575a4e4e444a5056",
  );
});

test("buildForwarderHookData rejects an invalid recipient", () => {
  assert.throws(() => buildForwarderHookData("not-a-real-address"));
});
