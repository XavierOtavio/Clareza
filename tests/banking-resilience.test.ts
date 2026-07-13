import assert from "node:assert/strict";
import test from "node:test";
import { BankProviderError, resetProviderCircuitsForTests, withProviderResilience } from "../lib/banking/resilience.ts";

test("retries transient provider failures with exponential delays", async () => {
  resetProviderCircuitsForTests();
  let attempts = 0;
  const delays: number[] = [];
  const result = await withProviderResilience("retry-test", async () => {
    attempts += 1;
    if (attempts < 3) throw new BankProviderError("temporary", 503, true);
    return "ok";
  }, { retries: 3, baseDelayMs: 10, sleep: async (delay) => { delays.push(delay); } });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[0] >= 10 && delays[0] < 60);
  assert.ok(delays[1] >= 20 && delays[1] < 70);
});

test("does not retry permanent provider validation failures", async () => {
  resetProviderCircuitsForTests();
  let attempts = 0;
  await assert.rejects(() => withProviderResilience("permanent-test", async () => {
    attempts += 1;
    throw new BankProviderError("invalid", 400, false);
  }, { retries: 3, sleep: async () => undefined }), /invalid/);
  assert.equal(attempts, 1);
});
