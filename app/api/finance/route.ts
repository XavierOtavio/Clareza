import { requireSupabaseAdmin } from "@/db";
import { MockBankDataProvider } from "@/lib/banking/provider";
import { normalizeCsvTransactions, parseCsvText } from "@/lib/transactions/csv";
import { createTransactionFingerprint } from "@/lib/transactions/deduplication";
import { findMatchingCategorizationRule, type CategorizationRule } from "@/lib/transactions/rules";
import { financeActionSchema, type FinanceAction } from "@/lib/transactions/validation";

export const dynamic = "force-dynamic";

const WORKSPACE_ID = "demo-workspace";
const ACTIVE_MONTH = "2026-07";

const DEFAULT_CATEGORIES = [
  ["category-home", "Casa", "expense"],
  ["category-housing", "Habitação", "expense"],
  ["category-grocery", "Supermercado", "expense"],
  ["category-transport", "Transportes", "expense"],
  ["category-restaurants", "Restaurantes", "expense"],
  ["category-health", "Saúde", "expense"],
  ["category-education", "Educação", "expense"],
  ["category-leisure", "Lazer", "expense"],
  ["category-income", "Rendimentos", "income"],
  ["category-transfer", "Transferência", "transfer"],
  ["category-other", "Outros", "expense"],
] as const;

type DatabaseRow = Record<string, unknown>;

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

async function seedCategories() {
  const supabase = requireSupabaseAdmin();
  const { error } = await supabase.from("categories").upsert(
    DEFAULT_CATEGORIES.map(([id, name, kind]) => ({ id, workspace_id: WORKSPACE_ID, name, kind, is_system: true })),
    { onConflict: "workspace_id,name", ignoreDuplicates: true },
  );
  failOnDatabaseError(error, "Could not seed categories");

  for (const [id, name] of DEFAULT_CATEGORIES) {
    const { error: updateError } = await supabase
      .from("transactions")
      .update({ category_id: id })
      .eq("workspace_id", WORKSPACE_ID)
      .eq("category", name)
      .is("category_id", null);
    failOnDatabaseError(updateError, `Could not link the ${name} category`);
  }
}

async function seedDemoData(force = false) {
  const supabase = requireSupabaseAdmin();

  if (force) {
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
  await seedCategories();

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

  const categoryIds = Object.fromEntries(DEFAULT_CATEGORIES.map(([id, name]) => [name, id]));
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
    original_description: description,
    merchant,
    original_merchant: merchant,
    amount_cents: amount,
    currency: "EUR",
    category,
    original_category: category,
    category_id: categoryIds[String(category)],
    category_source: "original",
    categorization_confidence: 1,
    status,
    booked_at: bookedAt,
    source: "synced",
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

function mapAccount(row: DatabaseRow) {
  return { id: row.id, name: row.name, type: row.type, source: row.source, institutionName: row.institution_name, currency: row.currency, balanceCents: row.balance_cents, availableBalanceCents: row.available_balance_cents, isHidden: row.is_hidden };
}

async function loadState() {
  const supabase = requireSupabaseAdmin();
  const [workspaceResult, accountsResult, transactionsResult, budgetsResult, goalsResult, connectionsResult, categoriesResult, rulesResult, editsResult, importsResult] = await Promise.all([
    supabase.from("workspaces").select("id,name,type,is_demo").eq("id", WORKSPACE_ID).single(),
    supabase.from("accounts").select("*").eq("workspace_id", WORKSPACE_ID).order("created_at").order("id"),
    supabase.from("transactions").select("*").eq("workspace_id", WORKSPACE_ID).order("booked_at", { ascending: false }).order("id", { ascending: false }),
    supabase.from("budgets").select("*").eq("workspace_id", WORKSPACE_ID).eq("month", ACTIVE_MONTH).order("limit_cents", { ascending: false }),
    supabase.from("goals").select("*").eq("workspace_id", WORKSPACE_ID).order("priority").order("id"),
    supabase.from("bank_connections").select("*").eq("workspace_id", WORKSPACE_ID).order("institution_name"),
    supabase.from("categories").select("*").eq("workspace_id", WORKSPACE_ID).order("kind").order("name"),
    supabase.from("categorization_rules").select("*").eq("workspace_id", WORKSPACE_ID).order("priority", { ascending: false }).order("name"),
    supabase.from("transaction_user_edits").select("transaction_id,category_id,version").eq("workspace_id", WORKSPACE_ID),
    supabase.from("import_jobs").select("*").eq("workspace_id", WORKSPACE_ID).order("created_at", { ascending: false }).limit(5),
  ]);

  for (const [context, result] of [
    ["workspace", workspaceResult], ["accounts", accountsResult], ["transactions", transactionsResult], ["budgets", budgetsResult], ["goals", goalsResult],
    ["connections", connectionsResult], ["categories", categoriesResult], ["rules", rulesResult], ["transaction edits", editsResult], ["imports", importsResult],
  ] as const) failOnDatabaseError(result.error, `Could not load ${context}`);

  const categories = categoriesResult.data as DatabaseRow[];
  const categoryById = new Map(categories.map((row) => [String(row.id), String(row.name)]));
  const editByTransaction = new Map((editsResult.data as DatabaseRow[]).map((row) => [String(row.transaction_id), row]));
  const workspace = workspaceResult.data as DatabaseRow;

  return {
    mode: "demo",
    asOf: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name, type: workspace.type, isDemo: workspace.is_demo },
    accounts: (accountsResult.data as DatabaseRow[]).map(mapAccount),
    transactions: (transactionsResult.data as DatabaseRow[]).map((row) => {
      const edit = editByTransaction.get(String(row.id));
      const effectiveCategoryId = edit?.category_id ?? row.category_id;
      return {
        id: row.id,
        accountId: row.account_id,
        description: row.description,
        merchant: row.merchant,
        amountCents: row.amount_cents,
        currency: row.currency,
        category: categoryById.get(String(effectiveCategoryId)) ?? row.category,
        categoryId: effectiveCategoryId,
        categorySource: edit ? "user" : row.category_source,
        categorizationConfidence: edit ? 1 : row.categorization_confidence,
        status: row.status,
        bookedAt: row.booked_at,
        source: row.source,
        isInternalTransfer: row.is_internal_transfer,
      };
    }),
    categories: categories.map((row) => ({ id: row.id, name: row.name, kind: row.kind, isSystem: row.is_system })),
    rules: (rulesResult.data as DatabaseRow[]).map((row) => ({ id: row.id, name: row.name, field: row.field, operator: row.operator, pattern: row.pattern, categoryId: row.category_id, categoryName: categoryById.get(String(row.category_id)) ?? "Outros", priority: row.priority, isActive: row.is_active })),
    imports: (importsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, fileName: row.file_name, status: row.status, totalRows: row.total_rows, importedRows: row.imported_rows, duplicateRows: row.duplicate_rows, invalidRows: row.invalid_rows, createdAt: row.created_at })),
    budgets: (budgetsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, category: row.category, limitCents: row.limit_cents, month: row.month, rollover: row.rollover })),
    goals: (goalsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, name: row.name, targetCents: row.target_cents, currentCents: row.current_cents, targetDate: row.target_date, priority: row.priority })),
    connections: (connectionsResult.data as DatabaseRow[]).map((row) => ({ id: row.id, provider: row.provider, institutionId: row.institution_id, institutionName: row.institution_name, status: row.status, lastSyncedAt: row.last_synced_at, consentExpiresAt: row.consent_expires_at })),
  };
}

function configurationError() {
  return Response.json({ error: "Supabase is not configured. The browser will use the labelled local demonstration dataset." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

function invalidAction(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return Response.json({ error: "Invalid action data.", details: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) }, { status: 400 });
}

async function ensureWorkspaceEntity(table: string, id: string, label: string) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from(table).select("id").eq("id", id).eq("workspace_id", WORKSPACE_ID).maybeSingle();
  failOnDatabaseError(error, `Could not validate ${label}`);
  if (!data) throw new Error(`${label} does not belong to the active workspace.`);
}

async function loadRules(): Promise<CategorizationRule[]> {
  const supabase = requireSupabaseAdmin();
  const [{ data: rows, error }, { data: categories, error: categoryError }] = await Promise.all([
    supabase.from("categorization_rules").select("*").eq("workspace_id", WORKSPACE_ID).eq("is_active", true),
    supabase.from("categories").select("id,name").eq("workspace_id", WORKSPACE_ID),
  ]);
  failOnDatabaseError(error, "Could not load categorization rules");
  failOnDatabaseError(categoryError, "Could not load categories");
  const names = new Map((categories as DatabaseRow[]).map((row) => [String(row.id), String(row.name)]));
  return (rows as DatabaseRow[]).map((row) => ({ id: String(row.id), name: String(row.name), field: row.field as CategorizationRule["field"], operator: row.operator as CategorizationRule["operator"], pattern: String(row.pattern), categoryId: String(row.category_id), categoryName: names.get(String(row.category_id)) ?? "Outros", priority: Number(row.priority), isActive: Boolean(row.is_active) }));
}

async function handleCsvImport(action: Extract<FinanceAction, { type: "importTransactionsCsv" }>) {
  const supabase = requireSupabaseAdmin();
  await ensureWorkspaceEntity("accounts", action.accountId, "Account");

  const parsed = parseCsvText(action.content, action.delimiter);
  const normalized = normalizeCsvTransactions(parsed, action.mapping);
  const importId = newId("import");
  const { error: jobError } = await supabase.from("import_jobs").insert({
    id: importId,
    workspace_id: WORKSPACE_ID,
    account_id: action.accountId,
    file_name: action.fileName,
    status: "processing",
    total_rows: parsed.rows.length,
    mapping: action.mapping,
    created_at: new Date().toISOString(),
  });
  failOnDatabaseError(jobError, "Could not create the import job");

  const [{ data: categoryRows, error: categoryError }, { data: existingRows, error: existingError }, rules] = await Promise.all([
    supabase.from("categories").select("id,name").eq("workspace_id", WORKSPACE_ID),
    supabase.from("transactions").select("import_fingerprint").eq("workspace_id", WORKSPACE_ID).eq("account_id", action.accountId).not("import_fingerprint", "is", null),
    loadRules(),
  ]);
  failOnDatabaseError(categoryError, "Could not load categories for import");
  failOnDatabaseError(existingError, "Could not inspect previous imports");

  const categories = new Map((categoryRows as DatabaseRow[]).map((row) => [String(row.name).toLocaleLowerCase("pt-PT"), { id: String(row.id), name: String(row.name) }]));
  const fallbackCategory = categories.get("outros")!;
  const knownFingerprints = new Set((existingRows as DatabaseRow[]).map((row) => String(row.import_fingerprint)));
  const batchFingerprints = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  let duplicateRows = 0;

  for (const transaction of normalized.valid) {
    const fingerprint = await createTransactionFingerprint(action.accountId, transaction.bookedAt, transaction.amountCents, transaction.description);
    if (knownFingerprints.has(fingerprint) || batchFingerprints.has(fingerprint)) {
      duplicateRows += 1;
      continue;
    }
    batchFingerprints.add(fingerprint);

    const rule = findMatchingCategorizationRule(transaction, rules);
    const importedCategory = categories.get(transaction.category.toLocaleLowerCase("pt-PT")) ?? fallbackCategory;
    const effectiveCategory = rule ? { id: rule.categoryId, name: rule.categoryName } : importedCategory;
    inserts.push({
      id: newId("transaction"),
      workspace_id: WORKSPACE_ID,
      account_id: action.accountId,
      description: transaction.description,
      original_description: transaction.description,
      merchant: transaction.merchant,
      original_merchant: transaction.merchant,
      amount_cents: transaction.amountCents,
      currency: "EUR",
      category: importedCategory.name,
      original_category: transaction.category,
      category_id: effectiveCategory.id,
      category_source: rule ? "rule" : "original",
      categorization_confidence: rule ? 1 : transaction.category === importedCategory.name ? 0.8 : 0,
      status: transaction.status,
      booked_at: transaction.bookedAt,
      source: "imported",
      is_internal_transfer: false,
      is_demo: true,
      import_job_id: importId,
      import_fingerprint: fingerprint,
      created_at: new Date().toISOString(),
    });
  }

  if (inserts.length) {
    const { error } = await supabase.from("transactions").insert(inserts);
    failOnDatabaseError(error, "Could not import transactions");
  }

  const status = normalized.errors.length ? "completed_with_errors" : "completed";
  const { error: completionError } = await supabase.from("import_jobs").update({
    status,
    imported_rows: inserts.length,
    duplicate_rows: duplicateRows,
    invalid_rows: normalized.errors.length,
    error_summary: normalized.errors.slice(0, 20),
    completed_at: new Date().toISOString(),
  }).eq("id", importId).eq("workspace_id", WORKSPACE_ID);
  failOnDatabaseError(completionError, "Could not complete the import job");
  await audit("transactions.csv_imported", "import_job", importId, { importedRows: inserts.length, duplicateRows, invalidRows: normalized.errors.length });
}

async function reapplyRulesToExisting() {
  const supabase = requireSupabaseAdmin();
  const [{ data: transactions, error }, { data: edits, error: editsError }, { data: categories, error: categoriesError }, rules] = await Promise.all([
    supabase.from("transactions").select("id,description,merchant,category").eq("workspace_id", WORKSPACE_ID),
    supabase.from("transaction_user_edits").select("transaction_id").eq("workspace_id", WORKSPACE_ID),
    supabase.from("categories").select("id,name").eq("workspace_id", WORKSPACE_ID),
    loadRules(),
  ]);
  failOnDatabaseError(error, "Could not load transactions for rule application");
  failOnDatabaseError(editsError, "Could not load transaction edits");
  failOnDatabaseError(categoriesError, "Could not load categories for rule application");
  const protectedTransactions = new Set((edits as DatabaseRow[]).map((row) => String(row.transaction_id)));
  const categoryByName = new Map((categories as DatabaseRow[]).map((row) => [String(row.name).toLocaleLowerCase("pt-PT"), String(row.id)]));
  const fallbackCategoryId = categoryByName.get("outros")!;
  const groups = new Map<string, { categoryId: string; confidence: number; ids: string[] }>();
  let matched = 0;

  for (const row of transactions as DatabaseRow[]) {
    if (protectedTransactions.has(String(row.id))) continue;
    const rule = findMatchingCategorizationRule({ description: String(row.description), merchant: row.merchant ? String(row.merchant) : null }, rules);
    if (rule) matched += 1;
    const categoryId = rule?.categoryId ?? categoryByName.get(String(row.category).toLocaleLowerCase("pt-PT")) ?? fallbackCategoryId;
    const confidence = rule ? 1 : 0;
    const key = `${categoryId}:${confidence}`;
    const group = groups.get(key) ?? { categoryId, confidence, ids: [] };
    group.ids.push(String(row.id));
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const { error: updateError } = await supabase.from("transactions").update({ category_id: group.categoryId, category_source: group.confidence === 1 ? "rule" : "original", categorization_confidence: group.confidence }).in("id", group.ids).eq("workspace_id", WORKSPACE_ID);
    failOnDatabaseError(updateError, "Could not apply categorization rules");
  }
  return matched;
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

export async function POST(request: Request) {
  try {
    const supabase = requireSupabaseAdmin();
    await seedDemoData();
    const parsedAction = financeActionSchema.safeParse(await request.json());
    if (!parsedAction.success) return invalidAction(parsedAction.error);
    const action = parsedAction.data;

    if (action.type === "createAccount") {
      const id = newId("account");
      const { error } = await supabase.from("accounts").insert({ id, workspace_id: WORKSPACE_ID, name: action.name, type: action.accountType, source: "manual", institution_name: null, currency: "EUR", balance_cents: action.balanceCents, available_balance_cents: action.balanceCents, is_hidden: false, created_at: new Date().toISOString() });
      failOnDatabaseError(error, "Could not create the account");
      await audit("account.created", "account", id, { source: "manual" });
    } else if (action.type === "toggleAccountVisibility") {
      const { error } = await supabase.from("accounts").update({ is_hidden: action.isHidden }).eq("id", action.accountId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not update account visibility");
      await audit("account.visibility_changed", "account", action.accountId, { isHidden: action.isHidden });
    } else if (action.type === "createManualTransaction") {
      await ensureWorkspaceEntity("accounts", action.accountId, "Account");
      await ensureWorkspaceEntity("categories", action.categoryId, "Category");
      const { data: category, error: categoryError } = await supabase.from("categories").select("name").eq("id", action.categoryId).eq("workspace_id", WORKSPACE_ID).single();
      failOnDatabaseError(categoryError, "Could not load the transaction category");
      if (!category) throw new Error("Transaction category was not found.");
      const id = newId("transaction");
      const { error } = await supabase.from("transactions").insert({ id, workspace_id: WORKSPACE_ID, account_id: action.accountId, description: action.description, original_description: action.description, merchant: action.merchant || null, original_merchant: action.merchant || null, amount_cents: action.amountCents, currency: "EUR", category: category.name, original_category: category.name, category_id: action.categoryId, category_source: "original", categorization_confidence: 1, status: action.status, booked_at: action.bookedAt, source: "manual", is_internal_transfer: action.isInternalTransfer, is_demo: true, created_at: new Date().toISOString() });
      failOnDatabaseError(error, "Could not create the transaction");
      await audit("transaction.created", "transaction", id, { source: "manual" });
    } else if (action.type === "createBudget") {
      const id = newId("budget");
      const { error } = await supabase.from("budgets").upsert({ id, workspace_id: WORKSPACE_ID, category: action.category, limit_cents: action.limitCents, month: ACTIVE_MONTH, rollover: false }, { onConflict: "workspace_id,category,month" });
      failOnDatabaseError(error, "Could not save the budget");
      await audit("budget.upserted", "budget", id, { category: action.category });
    } else if (action.type === "createGoal") {
      const id = newId("goal");
      const { error } = await supabase.from("goals").insert({ id, workspace_id: WORKSPACE_ID, name: action.name, target_cents: action.targetCents, current_cents: action.currentCents, target_date: action.targetDate || null, priority: "medium" });
      failOnDatabaseError(error, "Could not create the goal");
      await audit("goal.created", "goal", id);
    } else if (action.type === "updateTransactionCategory") {
      await ensureWorkspaceEntity("transactions", action.transactionId, "Transaction");
      await ensureWorkspaceEntity("categories", action.categoryId, "Category");
      const { data: existing, error: existingError } = await supabase.from("transaction_user_edits").select("id,version").eq("workspace_id", WORKSPACE_ID).eq("transaction_id", action.transactionId).maybeSingle();
      failOnDatabaseError(existingError, "Could not inspect the transaction edit");
      const { error } = await supabase.from("transaction_user_edits").upsert({ id: existing?.id ?? newId("transaction-edit"), workspace_id: WORKSPACE_ID, transaction_id: action.transactionId, category_id: action.categoryId, version: (existing?.version ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,transaction_id" });
      failOnDatabaseError(error, "Could not update the transaction category");
      await audit("transaction.category_changed", "transaction", action.transactionId, { categoryId: action.categoryId });
    } else if (action.type === "createCategory") {
      const id = newId("category");
      const { error } = await supabase.from("categories").insert({ id, workspace_id: WORKSPACE_ID, name: action.name, kind: action.kind, is_system: false });
      failOnDatabaseError(error, "Could not create the category");
      await audit("category.created", "category", id, { kind: action.kind });
    } else if (action.type === "createCategorizationRule") {
      await ensureWorkspaceEntity("categories", action.categoryId, "Category");
      const id = newId("rule");
      const { error } = await supabase.from("categorization_rules").insert({ id, workspace_id: WORKSPACE_ID, name: action.name, field: action.field, operator: action.operator, pattern: action.pattern, category_id: action.categoryId, priority: action.priority, is_active: true });
      failOnDatabaseError(error, "Could not create the categorization rule");
      const matched = action.applyToExisting ? await reapplyRulesToExisting() : 0;
      await audit("categorization_rule.created", "categorization_rule", id, { matchedTransactions: matched });
    } else if (action.type === "toggleCategorizationRule") {
      const { error } = await supabase.from("categorization_rules").update({ is_active: action.isActive }).eq("id", action.ruleId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not update the categorization rule");
      const matched = await reapplyRulesToExisting();
      await audit("categorization_rule.toggled", "categorization_rule", action.ruleId, { isActive: action.isActive, matchedTransactions: matched });
    } else if (action.type === "deleteCategorizationRule") {
      const { error } = await supabase.from("categorization_rules").delete().eq("id", action.ruleId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not delete the categorization rule");
      const matched = await reapplyRulesToExisting();
      await audit("categorization_rule.deleted", "categorization_rule", action.ruleId, { matchedTransactions: matched });
    } else if (action.type === "importTransactionsCsv") {
      await handleCsvImport(action);
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
      const otherCategory = DEFAULT_CATEGORIES.find(([, name]) => name === "Outros")!;
      const { error: transactionsError } = await supabase.from("transactions").upsert(providerTransactions.map((transaction) => ({ id: transaction.id, workspace_id: WORKSPACE_ID, account_id: transaction.accountId, provider_transaction_id: transaction.id, description: transaction.description, original_description: transaction.description, merchant: transaction.merchant ?? null, original_merchant: transaction.merchant ?? null, amount_cents: transaction.amountCents, currency: transaction.currency, category: otherCategory[1], original_category: otherCategory[1], category_id: otherCategory[0], category_source: "original", categorization_confidence: 0, status: transaction.status, booked_at: transaction.bookedAt, source: "synced", is_internal_transfer: false, is_demo: true, created_at: new Date().toISOString() })), { onConflict: "workspace_id,provider_transaction_id", ignoreDuplicates: true });
      failOnDatabaseError(transactionsError, "Could not import transactions");
      await audit("bank.connected", "bank_connection", connectionId, { provider: "mock", institutionId: connection.institutionId });
    } else if (action.type === "disconnectBank") {
      const { error } = await supabase.from("bank_connections").update({ status: "revoked" }).eq("id", action.connectionId).eq("workspace_id", WORKSPACE_ID);
      failOnDatabaseError(error, "Could not revoke the connection");
      await audit("bank.revoked", "bank_connection", action.connectionId);
    } else if (action.type === "resetDemo") {
      await seedDemoData(true);
      await audit("demo.reset", "workspace", WORKSPACE_ID);
    }

    return Response.json(await loadState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured")) return configurationError();
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the change." }, { status: 500 });
  }
}
