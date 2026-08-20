import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_RANK } from "./cctp-store";

test("status rank is monotonically increasing through the happy path", () => {
  assert.ok(STATUS_RANK.burned < STATUS_RANK.attesting);
  assert.ok(STATUS_RANK.attesting < STATUS_RANK.attested);
  assert.ok(STATUS_RANK.attested < STATUS_RANK.minting);
  assert.ok(STATUS_RANK.minting < STATUS_RANK.completed);
});
