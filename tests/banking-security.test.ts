import assert from "node:assert/strict";
import test from "node:test";
import { callbackStateIsUsable, createCallbackState, buildCallbackUrl, hashCallbackState } from "../lib/banking/security.ts";
import { decimalAmountToMinorUnits } from "../lib/banking/money.ts";

test("converts provider decimal strings without floating point arithmetic", () => {
  assert.equal(decimalAmountToMinorUnits("1234.56", "EUR"), 123456);
  assert.equal(decimalAmountToMinorUnits("-0.005", "EUR"), -1);
  assert.equal(decimalAmountToMinorUnits("1200", "JPY"), 1200);
  assert.equal(decimalAmountToMinorUnits("1.2345", "BHD"), 1235);
  assert.throws(() => decimalAmountToMinorUnits("1,20", "EUR"), /Invalid monetary amount/);
});

test("accepts callback state once and rejects expired, used, or changed state", () => {
  const state = createCallbackState();
  const base = { state, expectedHash: hashCallbackState(state), expiresAt: "2026-07-13T12:15:00.000Z", usedAt: null, now: new Date("2026-07-13T12:00:00.000Z") };
  assert.equal(callbackStateIsUsable(base), true);
  assert.equal(callbackStateIsUsable({ ...base, state: `${state}changed` }), false);
  assert.equal(callbackStateIsUsable({ ...base, usedAt: "2026-07-13T12:01:00.000Z" }), false);
  assert.equal(callbackStateIsUsable({ ...base, now: new Date("2026-07-13T12:16:00.000Z") }), false);
});

test("requires HTTPS for provider callbacks outside localhost", () => {
  assert.equal(buildCallbackUrl("http://localhost:3000", "connection-1"), "http://localhost:3000/api/banking/callback?connection=connection-1");
  assert.throws(() => buildCallbackUrl("http://clareza.example", "connection-1"), /must use HTTPS/);
});
