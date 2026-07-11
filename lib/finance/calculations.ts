export type FinancialAccount = {
  id?: string;
  type: string;
  balanceCents: number;
  availableBalanceCents?: number | null;
  isHidden: number | boolean;
};

export type FinancialTransaction = {
  accountId?: string;
  amountCents: number;
  category: string;
  status: "pending" | "booked";
  isInternalTransfer: number | boolean;
};

export type FinancialData = {
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
};

export function calculateMetrics(data: FinancialData) {
  const visible = data.accounts.filter((account) => !Boolean(account.isHidden));
  const hiddenAccountIds = new Set(data.accounts.filter((account) => Boolean(account.isHidden) && account.id).map((account) => account.id));
  const visibleTransactions = data.transactions.filter((transaction) => !transaction.accountId || !hiddenAccountIds.has(transaction.accountId));
  const assets = visible.filter((account) => account.balanceCents > 0).reduce((total, account) => total + account.balanceCents, 0);
  const liabilities = visible.filter((account) => account.balanceCents < 0).reduce((total, account) => total + Math.abs(account.balanceCents), 0);
  const netWorth = assets - liabilities;
  const available = visible
    .filter((account) => ["checking", "savings", "cash"].includes(account.type))
    .reduce((total, account) => total + (account.availableBalanceCents ?? account.balanceCents), 0);
  const booked = visibleTransactions.filter((transaction) => transaction.status === "booked" && !Boolean(transaction.isInternalTransfer));
  const income = booked.filter((transaction) => transaction.amountCents > 0).reduce((total, transaction) => total + transaction.amountCents, 0);
  const expenses = booked.filter((transaction) => transaction.amountCents < 0).reduce((total, transaction) => total + Math.abs(transaction.amountCents), 0);
  const savings = income - expenses;
  const savingsRate = income > 0 ? Math.round((savings / income) * 1000) / 10 : 0;
  const pending = visibleTransactions.filter((transaction) => transaction.status === "pending").reduce((total, transaction) => total + Math.abs(transaction.amountCents), 0);
  const spendByCategory = booked
    .filter((transaction) => transaction.amountCents < 0)
    .reduce<Record<string, number>>((map, transaction) => {
      map[transaction.category] = (map[transaction.category] ?? 0) + Math.abs(transaction.amountCents);
      return map;
    }, {});

  return { assets, liabilities, netWorth, available, income, expenses, savings, savingsRate, pending, spendByCategory };
}

export function parseMoneyToCents(value: string) {
  const trimmed = value.trim().replace(/\s/g, "");
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}
