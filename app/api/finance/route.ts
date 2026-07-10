import { getD1 } from "@/db";
import { MockBankDataProvider } from "@/lib/banking/provider";

export const dynamic = "force-dynamic";

const WORKSPACE_ID = "demo-workspace";
const ACTIVE_MONTH = "2026-07";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('personal', 'family')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit', 'cash', 'investment', 'loan')),
    source TEXT NOT NULL CHECK (source IN ('synced', 'manual', 'imported')),
    institution_name TEXT,
    currency TEXT NOT NULL DEFAULT 'EUR',
    balance_cents INTEGER NOT NULL,
    available_balance_cents INTEGER,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider_transaction_id TEXT,
    description TEXT NOT NULL,
    merchant TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    category TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'booked')),
    booked_at TEXT NOT NULL,
    is_internal_transfer INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
    month TEXT NOT NULL,
    rollover INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    current_cents INTEGER NOT NULL DEFAULT 0 CHECK (current_cents >= 0),
    target_date TEXT,
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high'))
  )`,
  `CREATE TABLE IF NOT EXISTS bank_connections (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    institution_id TEXT NOT NULL,
    institution_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('connected', 'syncing', 'requires_action', 'expired', 'revoked', 'error')),
    last_synced_at TEXT,
    consent_expires_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS accounts_workspace_idx ON accounts (workspace_id)",
  "CREATE INDEX IF NOT EXISTS transactions_workspace_date_idx ON transactions (workspace_id, booked_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_unique ON transactions (workspace_id, provider_transaction_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS budgets_workspace_category_month_unique ON budgets (workspace_id, category, month)",
  "CREATE UNIQUE INDEX IF NOT EXISTS connections_workspace_institution_unique ON bank_connections (workspace_id, institution_id)",
  "CREATE INDEX IF NOT EXISTS audit_workspace_date_idx ON audit_events (workspace_id, created_at)",
];

async function ensureSchema() {
  const d1 = await getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function audit(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  const d1 = await getD1();
  await d1
    .prepare(
      "INSERT INTO audit_events (id, workspace_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(newId("audit"), WORKSPACE_ID, action, entityType, entityId ?? null, metadata ? JSON.stringify(metadata) : null, new Date().toISOString())
    .run();
}

async function seedDemoData(force = false) {
  const d1 = await getD1();

  if (force) {
    await d1.batch([
      d1.prepare("DELETE FROM audit_events WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM transactions WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM budgets WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM goals WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM bank_connections WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM accounts WHERE workspace_id = ?").bind(WORKSPACE_ID),
      d1.prepare("DELETE FROM workspaces WHERE id = ?").bind(WORKSPACE_ID),
    ]);
  }

  await d1
    .prepare("INSERT OR IGNORE INTO workspaces (id, name, type, is_demo, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(WORKSPACE_ID, "Finanças da família", "family", 1, "2026-01-01T09:00:00.000Z")
    .run();

  const count = await d1.prepare("SELECT COUNT(*) AS total FROM accounts WHERE workspace_id = ?").bind(WORKSPACE_ID).first<{ total: number }>();
  if ((count?.total ?? 0) > 0) return;

  const accounts = [
    ["acc-main", "Conta principal", "checking", "synced", "Banco Atlântico", 381245, 367120],
    ["acc-savings", "Poupança", "savings", "synced", "Banco Atlântico", 914580, 914580],
    ["acc-card", "Cartão Universo", "credit", "synced", "Universo", -84215, -84215],
    ["acc-cash", "Dinheiro", "cash", "manual", null, 12500, 12500],
  ] as const;

  const accountStatements = accounts.map((account) =>
    d1
      .prepare(
        "INSERT INTO accounts (id, workspace_id, name, type, source, institution_name, currency, balance_cents, available_balance_cents, is_hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, 'EUR', ?, ?, 0, ?)"
      )
      .bind(account[0], WORKSPACE_ID, account[1], account[2], account[3], account[4], account[5], account[6], "2026-01-01T09:00:00.000Z")
  );

  const transactions = [
    ["tx-salary", "acc-main", "demo-salary-2026-07", "Salário", "Deloitte", 248500, "Rendimentos", "booked", "2026-07-01", 0],
    ["tx-rent", "acc-main", "demo-rent-2026-07", "Renda de casa", "Senhorio", -78000, "Habitação", "booked", "2026-07-02", 0],
    ["tx-continente", "acc-card", "demo-market-2026-07", "Continente Modelo Viseu", "Continente", -8734, "Supermercado", "booked", "2026-07-05", 0],
    ["tx-edp", "acc-main", "demo-energy-2026-07", "EDP Comercial", "EDP", -6210, "Casa", "booked", "2026-07-06", 0],
    ["tx-fuel", "acc-card", "demo-fuel-2026-07", "Galp Viseu", "Galp", -4872, "Transportes", "booked", "2026-07-07", 0],
    ["tx-restaurant", "acc-card", "demo-food-2026-07", "Mesa de Lemos", "Mesa de Lemos", -6850, "Restaurantes", "booked", "2026-07-08", 0],
    ["tx-transfer", "acc-main", "demo-transfer-2026-07", "Transferência para poupança", "Transferência interna", -25000, "Transferência", "booked", "2026-07-09", 1],
    ["tx-gym", "acc-card", "demo-gym-2026-07", "Fitness Hut", "Fitness Hut", -2990, "Saúde", "pending", "2026-07-10", 0],
  ] as const;

  const transactionStatements = transactions.map((transaction) =>
    d1
      .prepare(
        "INSERT INTO transactions (id, workspace_id, account_id, provider_transaction_id, description, merchant, amount_cents, currency, category, status, booked_at, is_internal_transfer, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, 1, ?)"
      )
      .bind(transaction[0], WORKSPACE_ID, transaction[1], transaction[2], transaction[3], transaction[4], transaction[5], transaction[6], transaction[7], transaction[8], transaction[9], "2026-07-10T10:00:00.000Z")
  );

  const budgetStatements = [
    ["budget-home", "Habitação", 85000],
    ["budget-market", "Supermercado", 30000],
    ["budget-transport", "Transportes", 15000],
    ["budget-restaurants", "Restaurantes", 12000],
  ].map((budget) =>
    d1.prepare("INSERT INTO budgets (id, workspace_id, category, limit_cents, month, rollover) VALUES (?, ?, ?, ?, ?, 0)").bind(budget[0], WORKSPACE_ID, budget[1], budget[2], ACTIVE_MONTH)
  );

  const goalStatements = [
    ["goal-emergency", "Fundo de emergência", 900000, 580000, "2027-02-28", "high"],
    ["goal-holiday", "Férias em família", 180000, 73500, "2027-06-01", "medium"],
  ].map((goal) =>
    d1.prepare("INSERT INTO goals (id, workspace_id, name, target_cents, current_cents, target_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(goal[0], WORKSPACE_ID, goal[1], goal[2], goal[3], goal[4], goal[5])
  );

  const connectionStatement = d1
    .prepare("INSERT INTO bank_connections (id, workspace_id, provider, institution_id, institution_name, status, last_synced_at, consent_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind("connection-demo", WORKSPACE_ID, "mock", "pt-demo-lusitano", "Banco Lusitano — Demonstração", "connected", "2026-07-10T09:42:00.000Z", "2026-09-27T23:59:59.000Z");

  await d1.batch([...accountStatements, ...transactionStatements, ...budgetStatements, ...goalStatements, connectionStatement]);
}

async function loadState() {
  const d1 = await getD1();
  const [workspace, accounts, transactions, budgets, goals, connections] = await Promise.all([
    d1.prepare("SELECT id, name, type, is_demo AS isDemo FROM workspaces WHERE id = ?").bind(WORKSPACE_ID).first(),
    d1.prepare("SELECT id, name, type, source, institution_name AS institutionName, currency, balance_cents AS balanceCents, available_balance_cents AS availableBalanceCents, is_hidden AS isHidden FROM accounts WHERE workspace_id = ? ORDER BY created_at, id").bind(WORKSPACE_ID).all(),
    d1.prepare("SELECT id, account_id AS accountId, description, merchant, amount_cents AS amountCents, currency, category, status, booked_at AS bookedAt, is_internal_transfer AS isInternalTransfer FROM transactions WHERE workspace_id = ? ORDER BY booked_at DESC, id DESC").bind(WORKSPACE_ID).all(),
    d1.prepare("SELECT id, category, limit_cents AS limitCents, month, rollover FROM budgets WHERE workspace_id = ? AND month = ? ORDER BY limit_cents DESC").bind(WORKSPACE_ID, ACTIVE_MONTH).all(),
    d1.prepare("SELECT id, name, target_cents AS targetCents, current_cents AS currentCents, target_date AS targetDate, priority FROM goals WHERE workspace_id = ? ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id").bind(WORKSPACE_ID).all(),
    d1.prepare("SELECT id, provider, institution_id AS institutionId, institution_name AS institutionName, status, last_synced_at AS lastSyncedAt, consent_expires_at AS consentExpiresAt FROM bank_connections WHERE workspace_id = ? ORDER BY institution_name").bind(WORKSPACE_ID).all(),
  ]);

  return {
    mode: "demo",
    asOf: new Date().toISOString(),
    workspace,
    accounts: accounts.results,
    transactions: transactions.results,
    budgets: budgets.results,
    goals: goals.results,
    connections: connections.results,
  };
}

export async function GET() {
  try {
    await ensureSchema();
    await seedDemoData();
    return Response.json(await loadState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os dados." }, { status: 500 });
  }
}

type FinanceAction =
  | { type: "createAccount"; name: string; accountType: string; balanceCents: number }
  | { type: "createBudget"; category: string; limitCents: number }
  | { type: "createGoal"; name: string; targetCents: number; currentCents: number; targetDate?: string }
  | { type: "updateTransactionCategory"; transactionId: string; category: string }
  | { type: "connectMockBank"; institutionId: string }
  | { type: "disconnectBank"; connectionId: string }
  | { type: "resetDemo" };

const accountTypes = new Set(["checking", "savings", "credit", "cash", "investment", "loan"]);
const categories = new Set(["Casa", "Habitação", "Supermercado", "Transportes", "Restaurantes", "Saúde", "Educação", "Lazer", "Rendimentos", "Outros"]);

export async function POST(request: Request) {
  try {
    await ensureSchema();
    await seedDemoData();
    const action = (await request.json()) as FinanceAction;
    const d1 = await getD1();

    if (action.type === "createAccount") {
      const name = action.name?.trim();
      if (!name || !accountTypes.has(action.accountType) || !Number.isSafeInteger(action.balanceCents)) {
        return Response.json({ error: "Dados da conta inválidos." }, { status: 400 });
      }
      const id = newId("account");
      await d1.prepare("INSERT INTO accounts (id, workspace_id, name, type, source, institution_name, currency, balance_cents, available_balance_cents, is_hidden, created_at) VALUES (?, ?, ?, ?, 'manual', NULL, 'EUR', ?, ?, 0, ?)").bind(id, WORKSPACE_ID, name, action.accountType, action.balanceCents, action.balanceCents, new Date().toISOString()).run();
      await audit("account.created", "account", id, { source: "manual" });
    } else if (action.type === "createBudget") {
      const category = action.category?.trim();
      if (!category || action.limitCents <= 0 || !Number.isSafeInteger(action.limitCents)) {
        return Response.json({ error: "Dados do orçamento inválidos." }, { status: 400 });
      }
      const id = newId("budget");
      await d1.prepare("INSERT INTO budgets (id, workspace_id, category, limit_cents, month, rollover) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(workspace_id, category, month) DO UPDATE SET limit_cents = excluded.limit_cents").bind(id, WORKSPACE_ID, category, action.limitCents, ACTIVE_MONTH).run();
      await audit("budget.upserted", "budget", id, { category });
    } else if (action.type === "createGoal") {
      const name = action.name?.trim();
      if (!name || action.targetCents <= 0 || action.currentCents < 0 || !Number.isSafeInteger(action.targetCents) || !Number.isSafeInteger(action.currentCents)) {
        return Response.json({ error: "Dados do objectivo inválidos." }, { status: 400 });
      }
      const id = newId("goal");
      await d1.prepare("INSERT INTO goals (id, workspace_id, name, target_cents, current_cents, target_date, priority) VALUES (?, ?, ?, ?, ?, ?, 'medium')").bind(id, WORKSPACE_ID, name, action.targetCents, action.currentCents, action.targetDate || null).run();
      await audit("goal.created", "goal", id);
    } else if (action.type === "updateTransactionCategory") {
      if (!action.transactionId || !categories.has(action.category)) {
        return Response.json({ error: "Categoria inválida." }, { status: 400 });
      }
      await d1.prepare("UPDATE transactions SET category = ? WHERE id = ? AND workspace_id = ?").bind(action.category, action.transactionId, WORKSPACE_ID).run();
      await audit("transaction.category_changed", "transaction", action.transactionId, { category: action.category });
    } else if (action.type === "connectMockBank") {
      const provider = new MockBankDataProvider();
      const connection = await provider.createConnection(action.institutionId, "", "");
      const accounts = await provider.fetchAccounts(connection.id);
      const transactions = await provider.fetchTransactions(connection.id);
      const connectionId = newId("connection");

      const statements = [
        d1.prepare("INSERT INTO bank_connections (id, workspace_id, provider, institution_id, institution_name, status, last_synced_at, consent_expires_at) VALUES (?, ?, 'mock', ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, institution_id) DO UPDATE SET status = excluded.status, last_synced_at = excluded.last_synced_at, consent_expires_at = excluded.consent_expires_at").bind(connectionId, WORKSPACE_ID, connection.institutionId, connection.institutionName, connection.status, new Date().toISOString(), connection.consentExpiresAt ?? null),
        ...accounts.map((account) => d1.prepare("INSERT OR IGNORE INTO accounts (id, workspace_id, name, type, source, institution_name, currency, balance_cents, available_balance_cents, is_hidden, created_at) VALUES (?, ?, ?, ?, 'synced', ?, ?, ?, ?, 0, ?)").bind(account.id, WORKSPACE_ID, account.name, account.type, connection.institutionName, account.currency, account.bookedBalanceCents, account.availableBalanceCents, new Date().toISOString())),
        ...transactions.map((transaction) => d1.prepare("INSERT OR IGNORE INTO transactions (id, workspace_id, account_id, provider_transaction_id, description, merchant, amount_cents, currency, category, status, booked_at, is_internal_transfer, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Outros', ?, ?, 0, 1, ?)").bind(transaction.id, WORKSPACE_ID, transaction.accountId, transaction.id, transaction.description, transaction.merchant ?? null, transaction.amountCents, transaction.currency, transaction.status, transaction.bookedAt, new Date().toISOString())),
      ];
      await d1.batch(statements);
      await audit("bank.connected", "bank_connection", connectionId, { provider: "mock", institutionId: connection.institutionId });
    } else if (action.type === "disconnectBank") {
      await d1.prepare("UPDATE bank_connections SET status = 'revoked' WHERE id = ? AND workspace_id = ?").bind(action.connectionId, WORKSPACE_ID).run();
      await audit("bank.revoked", "bank_connection", action.connectionId);
    } else if (action.type === "resetDemo") {
      await seedDemoData(true);
      await audit("demo.reset", "workspace", WORKSPACE_ID);
    } else {
      return Response.json({ error: "Acção desconhecida." }, { status: 400 });
    }

    return Response.json(await loadState());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível guardar a alteração." }, { status: 500 });
  }
}
