import assert from "node:assert/strict";
import test from "node:test";
import { cssTimeMs } from "../src/lib/motion";

test("CSS timing keeps the same duration when the stylesheet emits seconds", () => {
  assert.equal(cssTimeMs(" 200ms ", 120), 200);
  assert.equal(cssTimeMs(".2s", 120), 200);
  assert.equal(cssTimeMs("0s", 120), 0);
  assert.equal(cssTimeMs("", 120), 120);
});
