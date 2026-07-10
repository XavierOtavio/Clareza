import assert from "node:assert/strict";
import test from "node:test";
import { calculateMetrics, parseMoneyToCents } from "../lib/finance/calculations.ts";

test("parses Portuguese monetary input without floating-point storage", () => {
  assert.equal(parseMoneyToCents("1 234,56"), 123456);
  assert.equal(parseMoneyToCents("-84,20"), -8420);
  assert.ok(Number.isNaN(parseMoneyToCents("12,345")));
});

test("calculates net worth as assets minus liabilities", () => {
  const result = calculateMetrics({
    accounts: [
      { type: "checking", balanceCents: 200_00, availableBalanceCents: 180_00, isHidden: false },
      { type: "savings", balanceCents: 500_00, availableBalanceCents: 500_00, isHidden: false },
      { type: "credit", balanceCents: -120_00, availableBalanceCents: -120_00, isHidden: false },
      { type: "cash", balanceCents: 50_00, availableBalanceCents: 50_00, isHidden: true },
    ],
    transactions: [],
  });

  assert.equal(result.assets, 700_00);
  assert.equal(result.liabilities, 120_00);
  assert.equal(result.netWorth, 580_00);
  assert.equal(result.available, 680_00);
});

test("excludes pending and internal transfers from consumption", () => {
  const result = calculateMetrics({
    accounts: [],
    transactions: [
      { amountCents: 2_000_00, category: "Income", status: "booked", isInternalTransfer: false },
      { amountCents: -400_00, category: "Housing", status: "booked", isInternalTransfer: false },
      { amountCents: -200_00, category: "Transfer", status: "booked", isInternalTransfer: true },
      { amountCents: -75_00, category: "Health", status: "pending", isInternalTransfer: false },
    ],
  });

  assert.equal(result.income, 2_000_00);
  assert.equal(result.expenses, 400_00);
  assert.equal(result.savings, 1_600_00);
  assert.equal(result.savingsRate, 80);
  assert.equal(result.pending, 75_00);
  assert.deepEqual(result.spendByCategory, { Housing: 400_00 });
});
