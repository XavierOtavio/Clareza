import assert from "node:assert/strict";
import test from "node:test";
import { reconcileBankTransactions } from "../lib/banking/reconciliation.ts";

const accountMap = new Map([["provider-account", "local-account"]]);

test("replaces a matching pending transaction with the booked transaction", () => {
  const plan = reconcileBankTransactions({
    workspaceId: "workspace-1",
    providerAccountToLocal: accountMap,
    existing: [{ id: "local-pending", accountId: "local-account", providerTransactionId: "pending-1", providerPendingTransactionId: null, description: "Farmácia Central", amountCents: -1865, currency: "EUR", status: "pending", bookedAt: "2026-07-10" }],
    incoming: [{ id: "booked-1", pendingTransactionId: "pending-1", accountId: "provider-account", description: "Farmácia Central", amountCents: -1865, currency: "EUR", status: "booked", bookedAt: "2026-07-11" }],
  });
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].localId, "local-pending");
  assert.equal(plan.updates[0].replacedPendingProviderId, "pending-1");
});

test("infers pending-to-booked transitions and creates stable IDs for new transactions", () => {
  const input = {
    workspaceId: "workspace-1",
    providerAccountToLocal: accountMap,
    existing: [{ id: "local-pending", accountId: "local-account", providerTransactionId: "pending-2", providerPendingTransactionId: null, description: "Café São Bento", amountCents: -420, currency: "EUR", status: "pending" as const, bookedAt: "2026-07-10" }],
    incoming: [
      { id: "booked-2", accountId: "provider-account", description: "Cafe Sao Bento", amountCents: -420, currency: "EUR", status: "booked" as const, bookedAt: "2026-07-12" },
      { id: "salary-1", accountId: "provider-account", description: "Salário", amountCents: 250000, currency: "EUR", status: "booked" as const, bookedAt: "2026-07-01" },
    ],
  };
  const first = reconcileBankTransactions(input);
  const second = reconcileBankTransactions(input);
  assert.equal(first.updates[0].localId, "local-pending");
  assert.equal(first.inserts[0].localId, second.inserts[0].localId);
});
