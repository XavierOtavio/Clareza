import { requireSupabaseAdmin } from "@/db";
import { MockBankDataProvider } from "@/lib/banking/provider";

export const dynamic = "force-dynamic";

const WORKSPACE_ID = "demo-workspace";
const ACTIVE_MONTH = "2026-07";

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function failOnDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function audit(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  const supabase = requireSupabaseAdmin();
  const { error } = await supabase.from("audit_events").insert({
    id: newId("audit"),
    workspace_id: WORKSPACE_ID,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    metadata: metadata ?? null,
    created_at: new Date().toISOString(),
  });
  failOnDatabaseError(error, "Could not write the audit event");
}

async function seedDemoData(force = false) {
  const supabase = requireSupabaseAdmin();

  if (force) {
    for (const table of ["audit_events", "transactions", "budgets", "goals", "bank_connections", "accounts"]) {
      const { error } = await supabase.from(table).delete().eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, `Could not reset ${table}`);
    }
    const { error } = await supabase.from("workspaces").delete().eq("id", WORKSPACE_ID);
    failOnDatabaseError(error, "Could not reset the workspace");
  }

  const { error: workspaceError } = await supabase.from("workspaces").upsert({
    id: WORKSPACE_ID,
    name: "Finanças da família",
    type: "family",
    is_demo: true,
    created_at: "2026-01-01T09:00:00.000Z",
  });
  failOnDatabaseError(workspaceError, "Could not seed the workspace");

  const { count, error: countError } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  failOnDatabaseError(countError, "Could not inspect the demo workspace");
  if ((count ?? 0) > 0) return;

  const { error: accountsError } = await supabase.from("accounts").insert([
    { id: "acc-main", workspace_id: WORKSPACE_ID, name: "Conta principal", type: "checking", source: "synced", institution_name: "Banco Atlântico", currency: "EUR", balance_cents: 381245, available_balance_cents: 367120, is_hidden: false, created_at: "2026-01-01T09:00:00.000Z" },
    { id: "acc-savings", workspace_id: WORKSPACE_ID, name: "Poupança", type: "savings", source: "synced", institution_name: "Banco Atlântico", currency: "EUR", balance_cents: 914580, available_balance_cents: 914580, is_hidden: false, created_at: "2026-01-01T09:00:00.000Z" },
    { id: "acc-card", workspace_id: WORKSPACE_ID, name: "Cartão Universo", type: "credit", source: "synced", institution_name: "Universo", currency: "EUR", balance_cents: -84215, available_balance_cents: -84215, is_hidden: false, created_at: "2026-01-01T09:00:00.000Z" },
    { id: "acc-cash", workspace_id: WORKSPACE_ID, name: "Dinheiro", type: "cash", source: "manual", institution_name: null, currency: "EUR", balance_cents: 12500, available_balance_cents: 12500, is_hidden: false, created_at: "2026-01-01T09:00:00.000Z" },
  ]);
  failOnDatabaseError(accountsError, "Could not seed accounts");

  const demoTransactions = [
    ["tx-salary", "acc-main", "demo-salary-2026-07", "Salário", "Deloitte", 248500, "Rendimentos", "booked", "2026-07-01", false],
    ["tx-rent", "acc-main", "demo-rent-2026-07", "Renda de casa", "Senhorio", -78000, "Habitação", "booked", "2026-07-02", false],
    ["tx-continente", "acc-card", "demo-market-2026-07", "Continente Modelo Viseu", "Continente", -8734, "Supermercado", "booked", "2026-07-05", false],
    ["tx-edp", "acc-main", "demo-energy-2026-07", "EDP Comercial", "EDP", -6210, "Casa", "booked", "2026-07-06", false],
    ["tx-fuel", "acc-card", "demo-fuel-2026-07", "Galp Viseu", "Galp", -4872, "Transportes", "booked", "2026-07-07", false],
    ["tx-restaurant", "acc-card", "demo-food-2026-07", "Mesa de Lemos", "Mesa de Lemos", -6850, "Restaurantes", "booked", "2026-07-08", false],
    ["tx-transfer", "acc-main", "demo-transfer-2026-07", "Transferência para poupança", "Transferência interna", -25000, "Transferência", "booked", "2026-07-09", true],
    ["tx-gym", "acc-card", "demo-gym-2026-07", "Fitness Hut", "Fitness Hut", -2990, "Saúde", "pending", "2026-07-10", false],
  ].map(([id, accountId, providerId, description, merchant, amount, category, status, bookedAt, isInternal]) => ({
    id,
    workspace_id: WORKSPACE_ID,
    account_id: accountId,
    provider_transaction_id: providerId,
    description,
    merchant,
    amount_cents: amount,
    currency: "EUR",
    category,
    status,
    booked_at: bookedAt,
    is_internal_transfer: isInternal,
    is_demo: true,
    created_at: "2026-07-10T09:00:00.000Z",
  }));
  const { error: transactionsError } = await supabase.from("transactions").insert(demoTransactions);
  failOnDatabaseError(transactionsError, "Could not seed transactions");

  const { error: budgetsError } = await supabase.from("budgets").insert([
    { id: "budget-home", workspace_id: WORKSPACE_ID, category: "Habitação", limit_cents: 85000, month: ACTIVE_MONTH, rollover: false },
    { id: "budget-market", workspace_id: WORKSPACE_ID, category: "Supermercado", limit_cents: 30000, month: ACTIVE_MONTH, rollover: false },
    { id: "budget-transport", workspace_id: WORKSPACE_ID, category: "Transportes", limit_cents: 15000, month: ACTIVE_MONTH, rollover: false },
    { id: "budget-restaurants", workspace_id: WORKSPACE_ID, category: "Restaurantes", limit_cents: 12000, month: ACTIVE_MONTH, rollover: false },
  ]);
  failOnDatabaseError(budgetsError, "Could not seed budgets");

  const { error: goalsError } = await supabase.from("goals").insert([
    { id: "goal-emergency", workspace_id: WORKSPACE_ID, name: "Fundo de emergência", target_cents: 900000, current_cents: 580000, target_date: "2027-02-28", priority: "high" },
    { id: "goal-holiday", workspace_id: WORKSPACE_ID, name: "Férias em família", target_cents: 180000, current_cents: 73500, target_date: "2027-06-01", priority: "medium" },
  ]);
  failOnDatabaseError(goalsError, "Could not seed goals");

  const { error: connectionError } = await supabase.from("bank_connections").insert({
    id: "connection-demo",
    workspace_id: WORKSPACE_ID,
    provider: "mock",
    institution_id: "pt-demo-lusitano",
    institution_name: "Banco Lusitano — Demonstração",
    status: "connected",
    last_synced_at: "2026-07-10T09:42:00.000Z",
    consent_expires_at: "2026-09-27T23:59:59.000Z",
  });
  failOnDatabaseError(connectionError, "Could not seed the bank connection");
}

type DatabaseRow = Record<string, unknown>;

function mapAccount(row: DatabaseRow) {
  return { id: row.id, name: row.name, type: row.type, source: row.source, institutionName: row.institution_name, currency: row.currency, balanceCents: row.balance_cents, availableBalanceCents: row.available_balance_cents, isHidden: row.is_hidden };
}

function mapTransaction(row: DatabaseRow) {
  return { id: row.id, accountId: row.account_id, description: row.description, merchant: row.merchant, amountCents: row.amount_cents, currency: row.currency, category: row.category, status: row.status, bookedAt: row.booked_at, isInternalTransfer: row.is_internal_transfer };
}

async function loadState() {
  const supabase = requireSupabaseAdmin();
  const [workspaceResult, accountsResult, transactionsResult, budgetsResult, goalsResult, connectionsResult] = await Promise.all([
    supabase.from("workspaces").select("id,name,type,is_demo").eq("id", WORKSPACE_ID).single(),
    supabase.from("accounts").select("*").eq("workspace_id", WORKSPACE_ID).order("created_at").order("id"),
    supabase.from("transactions").select("*").eq("workspace_id", WORKSPACE_ID).order("booked_at", { ascending: false }).order("id", { ascending: false }),
    supabase.from("budgets").select("*").eq("workspace_id", WORKSPACE_ID).eq("month", ACTIVE_MONTH).order("limit_cents", { ascending: false }),
    supabase.from("goals").select("*").eq("workspace_id", WORKSPACE_ID).order("priority").order("id"),
    supabase.from("bank_connections").select("*").eq("workspace_id", WORKSPACE_ID).order("institution_name"),
  ]);

  for (const [context, result] of [
    ["workspace", workspaceResult], ["accounts", accountsResult], ["transactions", transactionsResult],
    ["budgets", budgetsResult], ["goals", goalsResult], ["connections", connectionsResult],
  ] as const) failOnDatabaseError(result.error, `Could not load ${context}`);

  const workspace = workspaceResult.data as DatabaseRow;
  return {
    mode: "demo",
    asOf: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name, type: workspace.type, isDemo: workspace.is_demo },
    accounts: (accountsResult.data as DatabaseRow[]).map(mapAccount),
    transactions: (transactionsResult.data as DatabaseRow[]).map(mapTransaction),
    budgets: (budgetsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, category: row.category, limitCents: row.limit_cents, month: row.month, rollover: row.rollover })),
    goals: (goalsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, name: row.name, targetCents: row.target_cents, currentCents: row.current_cents, targetDate: row.target_date, priority: row.priority })),
    connections: (connectionsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, provider: row.provider, institutionId: row.institution_id, institutionName: row.institution_name, status: row.status, lastSyncedAt: row.last_synced_at, consentExpiresAt: row.consent_expires_at })),
  };
}

function configurationError() {
  return Response.json(
    { error: "Supabase is not configured. The browser will use the labelled local demonstration dataset." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  try {
    requireSupabaseAdmin();
    await seedDemoData();
    return Response.json(await loadState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return configurationError();
    return Response.json({ error: error instanceof Error ? error.message : "Could not load finance data." }, { status: 500 });
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
    const supabase = requireSupabaseAdmin();
    await seedDemoData();
    const action = (await request.json()) as FinanceAction;

    if (action.type === "createAccount") {
      const name = action.name?.trim();
      if (!name || !accountTypes.has(action.accountType) || !Number.isSafeInteger(action.balanceCents)) return Response.json({ error: "Invalid account data." }, { status: 400 });
      const id = newId("account");
      const { error } = await supabase.from("accounts").insert({ id, workspace_id: WORKSPACE_ID, name, type: action.accountType, source: "manual", institution_name: null, currency: "EUR", balance_cents: action.balanceCents, available_balance_cents: action.balanceCents, is_hidden: false, created_at: new Date().toISOString() });
      failOnDatabaseError(error, "Could not create the account");
      await audit("account.created", "account", id, { source: "manual" });
    } else if (action.type === "createBudget") {
      const category = action.category?.trim();
      if (!category || action.limitCents <= 0 || !Number.isSafeInteger(action.limitCents)) return Response.json({ error: "Invalid budget data." }, { status: 400 });
      const id = newId("budget");
      const { error } = await supabase.from("budgets").upsert({ id, workspace_id: WORKSPACE_ID, category, limit_cents: action.limitCents, month: ACTIVE_MONTH, rollover: false }, { onConflict: "workspace_id,category,month" });
      failOnDatabaseError(error, "Could not save the budget");
      await audit("budget.upserted", "budget", id, { category });
    } else if (action.type === "createGoal") {
      const name = action.name?.trim();
      if (!name || action.targetCents <= 0 || action.currentCents < 0 || !Number.isSafeInteger(action.targetCents) || !Number.isSafeInteger(action.currentCents)) return Response.json({ error: "Invalid goal data." }, { status: 400 });
      const id = newId("goal");
      const { error } = await supabase.from("goals").insert({ id, workspace_id: WORKSPACE_ID, name, target_cents: action.targetCents, current_cents: action.currentCents, target_date: action.targetDate || null, priority: "medium" });
      failOnDatabaseError(error, "Could not create the goal");
      await audit("goal.created", "goal", id);
    } else if (action.type === "updateTransactionCategory") {
      if (!action.transactionId || !categories.has(action.category)) return Response.json({ error: "Invalid category." }, { status: 400 });
      const { error } = await supabase.from("transactions").update({ category: action.category }).eq("id", action.transactionId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not update the transaction");
      await audit("transaction.category_changed", "transaction", action.transactionId, { category: action.category });
    } else if (action.type === "connectMockBank") {
      const provider = new MockBankDataProvider();
      const connection = await provider.createConnection(action.institutionId, "", "");
      const providerAccounts = await provider.fetchAccounts(connection.id);
      const providerTransactions = await provider.fetchTransactions(connection.id);
      const connectionId = newId("connection");

      const { error: connectionError } = await supabase.from("bank_connections").upsert({ id: connectionId, workspace_id: WORKSPACE_ID, provider: "mock", institution_id: connection.institutionId, institution_name: connection.institutionName, status: connection.status, last_synced_at: new Date().toISOString(), consent_expires_at: connection.consentExpiresAt ?? null }, { onConflict: "workspace_id,institution_id" });
      failOnDatabaseError(connectionError, "Could not save the bank connection");

      const { error: accountsError } = await supabase.from("accounts").upsert(providerAccounts.map((account) => ({ id: account.id, workspace_id: WORKSPACE_ID, name: account.name, type: account.type, source: "synced", institution_name: connection.institutionName, currency: account.currency, balance_cents: account.bookedBalanceCents, available_balance_cents: account.availableBalanceCents, is_hidden: false, created_at: new Date().toISOString() })), { onConflict: "id" });
      failOnDatabaseError(accountsError, "Could not import bank accounts");

      const { error: transactionsError } = await supabase.from("transactions").upsert(providerTransactions.map((transaction) => ({ id: transaction.id, workspace_id: WORKSPACE_ID, account_id: transaction.accountId, provider_transaction_id: transaction.id, description: transaction.description, merchant: transaction.merchant ?? null, amount_cents: transaction.amountCents, currency: transaction.currency, category: "Outros", status: transaction.status, booked_at: transaction.bookedAt, is_internal_transfer: false, is_demo: true, created_at: new Date().toISOString() })), { onConflict: "workspace_id,provider_transaction_id", ignoreDuplicates: true });
      failOnDatabaseError(transactionsError, "Could not import transactions");
      await audit("bank.connected", "bank_connection", connectionId, { provider: "mock", institutionId: connection.institutionId });
    } else if (action.type === "disconnectBank") {
      const { error } = await supabase.from("bank_connections").update({ status: "revoked" }).eq("id", action.connectionId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not revoke the connection");
      await audit("bank.revoked", "bank_connection", action.connectionId);
    } else if (action.type === "resetDemo") {
      await seedDemoData(true);
      await audit("demo.reset", "workspace", WORKSPACE_ID);
    } else {
      return Response.json({ error: "Unknown action." }, { status: 400 });
    }

    return Response.json(await loadState());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return configurationError();
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the change." }, { status: 500 });
  }
}
