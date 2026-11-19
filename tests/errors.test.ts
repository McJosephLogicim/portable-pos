import assert from "node:assert/strict";
import test from "node:test";
import { friendlyError } from "../src/lib/errors";
import { parseCommand } from "../src/server/input";

test("people see plain words, never internals", () => {
  assert.equal(friendlyError(Error("Enter how much was spent.")), "Enter how much was spent.");
  assert.equal(friendlyError(Error("An open shift and at least one item are required.")), "An open shift and at least one item are required.");
  const generic = "Something went wrong. Try again.";
  assert.equal(friendlyError(new TypeError("Cannot read properties of undefined (reading 'id')")), generic);
  assert.equal(friendlyError(new DOMException("The database connection is closing.", "InvalidStateError")), generic);
  assert.equal(friendlyError(new SyntaxError("Unexpected token < in JSON at position 0")), generic);
  assert.equal(friendlyError(Error("relation \"register.sales\" does not exist at Object.query (pg.js:1:1)")), generic);
  assert.equal(friendlyError("boom"), generic);
  assert.match(friendlyError(new DOMException("full", "QuotaExceededError")), /out of storage/);
  const auth = Object.assign(new Error("Invalid login credentials"), { name: "AuthApiError", status: 400 });
  assert.equal(friendlyError(auth), "That email or password isn't right.");
});

test("a malformed request names no field or schema rule", () => {
  assert.throws(
    () => parseCommand({ action: "settings", name: "", settings: { payments: 4 } }),
    (error: Error) => !/settings\.|payments|expected|invalid_type/i.test(error.message),
  );
});
