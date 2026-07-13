import { createHash } from "node:crypto";
import type { ProviderTransaction } from "./provider";

export type StoredBankTransaction = {
  id: string;
  accountId: string;
  providerTransactionId: string | null;
  providerPendingTransactionId: string | null;
  description: string;
  amountCents: number;
  currency: string;
  status: "pending" | "booked";
  bookedAt: string;
};

export type ReconciledTransaction = ProviderTransaction & {
  localAccountId: string;
  localId: string;
  replacedPendingProviderId?: string;
};

function normalizedDescription(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-PT").replace(/[^a-z0-9]+/g, " ").trim();
}

function datesAreClose(left: string, right: string) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= 7 * 86_400_000;
}

function localTransactionId(workspaceId: string, localAccountId: string, providerId: string) {
  return `bank-tx-${createHash("sha256").update(`${workspaceId}:${localAccountId}:${providerId}`).digest("hex").slice(0, 32)}`;
}

export function reconcileBankTransactions(input: {
  workspaceId: string;
  providerAccountToLocal: Map<string, string>;
  existing: StoredBankTransaction[];
  incoming: ProviderTransaction[];
}) {
  const claimed = new Set<string>();
  const updates: ReconciledTransaction[] = [];
  const inserts: ReconciledTransaction[] = [];

  for (const transaction of input.incoming) {
    const localAccountId = input.providerAccountToLocal.get(transaction.accountId);
    if (!localAccountId) continue;
    const direct = input.existing.find((stored) =>
      stored.accountId === localAccountId
      && !claimed.has(stored.id)
      && (stored.providerTransactionId === transaction.id || stored.providerPendingTransactionId === transaction.id),
    );
    const explicitPending = transaction.pendingTransactionId
      ? input.existing.find((stored) => stored.accountId === localAccountId && stored.status === "pending" && !claimed.has(stored.id) && stored.providerTransactionId === transaction.pendingTransactionId)
      : undefined;
    const inferredPending = transaction.status === "booked"
      ? input.existing.find((stored) =>
        stored.accountId === localAccountId
        && stored.status === "pending"
        && !claimed.has(stored.id)
        && stored.amountCents === transaction.amountCents
        && stored.currency === transaction.currency
        && normalizedDescription(stored.description) === normalizedDescription(transaction.description)
        && datesAreClose(stored.bookedAt, transaction.bookedAt),
      )
      : undefined;
    const matched = direct ?? explicitPending ?? inferredPending;
    const reconciled: ReconciledTransaction = {
      ...transaction,
      localAccountId,
      localId: matched?.id ?? localTransactionId(input.workspaceId, localAccountId, transaction.id),
      replacedPendingProviderId: matched?.status === "pending" && transaction.status === "booked" ? matched.providerTransactionId ?? undefined : undefined,
    };
    if (matched) {
      claimed.add(matched.id);
      updates.push(reconciled);
    } else {
      inserts.push(reconciled);
    }
  }
  return { updates, inserts };
}
