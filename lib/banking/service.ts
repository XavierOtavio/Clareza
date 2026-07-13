import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { requireSupabaseAdmin } from "@/db";
import type { ProviderAccount } from "./provider";
import { createBankDataProvider, configuredProviderName, publicProviderMode } from "./provider-factory";
import { reconcileBankTransactions, type StoredBankTransaction } from "./reconciliation";
import { buildCallbackUrl, callbackStateIsUsable, createCallbackState, hashCallbackState } from "./security";
import { BankProviderError } from "./resilience";

export const DEMO_WORKSPACE_ID = "demo-workspace";
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

function id(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function fail(error: { message: string; code?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function accountId(workspaceId: string, connectionId: string, providerAccountId: string) {
  return `bank-account-${createHash("sha256").update(`${workspaceId}:${connectionId}:${providerAccountId}`).digest("hex").slice(0, 32)}`;
}

async function audit(action: string, entityId: string, metadata?: Record<string, unknown>) {
  const { error } = await requireSupabaseAdmin().from("audit_events").insert({
    id: id("audit"), workspace_id: DEMO_WORKSPACE_ID, action, entity_type: "bank_connection", entity_id: entityId,
    metadata: metadata ?? null, created_at: new Date().toISOString(),
  });
  fail(error, "Could not write the bank audit event");
}

export async function listBankInstitutions(country: string) {
  const provider = createBankDataProvider();
  const institutions = await provider.listInstitutions(country);
  return { ...publicProviderMode(), institutions };
}

export async function startBankConnection(input: { country: string; institutionId: string; appOrigin: string }) {
  const supabase = requireSupabaseAdmin();
  const providerName = configuredProviderName();
  const provider = createBankDataProvider(providerName);
  const institutions = await provider.listInstitutions(input.country);
  const institution = institutions.find((item) => item.id === input.institutionId);
  if (!institution) throw new BankProviderError("The selected institution is not available for this country.", 400, false);

  const { data: existing, error: existingError } = await supabase.from("bank_connections")
    .select("id").eq("workspace_id", DEMO_WORKSPACE_ID).eq("institution_id", institution.id).maybeSingle();
  fail(existingError, "Could not inspect the existing bank connection");
  const connectionId = String(existing?.id ?? id("connection"));
  const state = createCallbackState();
  const callbackUrl = buildCallbackUrl(input.appOrigin, connectionId);
  const connection = await provider.createConnection(institution.id, callbackUrl, state);
  const now = new Date();
  const stateExpiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();

  const { error: institutionError } = await supabase.from("financial_institutions").upsert({
    id: `institution-${createHash("sha256").update(`${DEMO_WORKSPACE_ID}:${providerName}:${institution.id}`).digest("hex").slice(0, 32)}`,
    workspace_id: DEMO_WORKSPACE_ID,
    provider: providerName,
    provider_institution_id: institution.id,
    country: input.country,
    name: institution.name,
    logo_url: institution.logoUrl ?? null,
    last_verified_at: now.toISOString(),
  }, { onConflict: "workspace_id,provider,provider_institution_id" });
  fail(institutionError, "Could not cache the financial institution");

  const { error: connectionError } = await supabase.from("bank_connections").upsert({
    id: connectionId,
    workspace_id: DEMO_WORKSPACE_ID,
    provider: providerName,
    country: input.country,
    institution_id: institution.id,
    institution_name: institution.name,
    provider_connection_id: connection.id,
    status: connection.status,
    consent_expires_at: connection.consentExpiresAt ?? null,
    callback_state_hash: hashCallbackState(state),
    callback_state_expires_at: stateExpiresAt,
    callback_state_used_at: providerName === "mock" ? now.toISOString() : null,
    last_attempted_at: now.toISOString(),
    error_code: null,
    error_message: null,
  }, { onConflict: "workspace_id,institution_id" });
  fail(connectionError, "Could not save the bank connection");

  const { error: consentError } = await supabase.from("consents").insert({
    id: id("consent"), workspace_id: DEMO_WORKSPACE_ID, bank_connection_id: connectionId,
    provider_agreement_id: connection.agreementId ?? null,
    status: connection.status === "connected" ? "active" : "pending",
    granted_at: connection.status === "connected" ? now.toISOString() : null,
    expires_at: connection.consentExpiresAt ?? null,
  });
  fail(consentError, "Could not save the consent metadata");
  await audit("bank.connection_started", connectionId, { provider: providerName, institutionId: institution.id, environment: publicProviderMode().environment });

  if (connection.status === "connected") await synchronizeBankConnection(connectionId, "callback", `initial:${connection.id}`);
  return { connectionId, status: connection.status, redirectUrl: connection.redirectUrl, ...publicProviderMode() };
}

async function upsertProviderAccounts(connection: Row, accounts: ProviderAccount[]) {
  const supabase = requireSupabaseAdmin();
  const providerToLocal = new Map<string, string>();
  const capturedAt = new Date().toISOString();
  for (const account of accounts) {
    const localId = accountId(DEMO_WORKSPACE_ID, String(connection.id), account.id);
    providerToLocal.set(account.id, localId);
    const { error } = await supabase.from("accounts").upsert({
      id: localId, workspace_id: DEMO_WORKSPACE_ID, bank_connection_id: connection.id,
      provider_account_id: account.id, name: account.name, type: account.type, source: "synced",
      institution_name: connection.institution_name, currency: account.currency,
      balance_cents: account.bookedBalanceCents, available_balance_cents: account.availableBalanceCents,
      masked_identifier: account.maskedIdentifier ?? null, balance_as_of: account.balanceAsOf ?? capturedAt,
      is_hidden: false, created_at: capturedAt,
    }, { onConflict: "workspace_id,bank_connection_id,provider_account_id" });
    fail(error, "Could not synchronize a bank account");
    const { error: snapshotError } = await supabase.from("balance_snapshots").insert({
      id: id("balance"), workspace_id: DEMO_WORKSPACE_ID, account_id: localId,
      booked_balance_cents: account.bookedBalanceCents, available_balance_cents: account.availableBalanceCents,
      pending_amount_cents: null, currency: account.currency, source: "provider", captured_at: capturedAt,
    });
    fail(snapshotError, "Could not save a balance snapshot");
  }
  return { providerToLocal, capturedAt };
}

function transactionRow(transaction: ReturnType<typeof reconcileBankTransactions>["inserts"][number], categoryId: string, connectionId: string) {
  return {
    id: transaction.localId,
    workspace_id: DEMO_WORKSPACE_ID,
    account_id: transaction.localAccountId,
    provider_transaction_id: transaction.id,
    provider_pending_transaction_id: transaction.status === "pending" ? transaction.id : transaction.replacedPendingProviderId ?? transaction.pendingTransactionId ?? null,
    description: transaction.description,
    original_description: transaction.description,
    merchant: transaction.merchant ?? null,
    original_merchant: transaction.merchant ?? null,
    amount_cents: transaction.amountCents,
    currency: transaction.currency,
    category: "Outros",
    original_category: "Outros",
    category_id: categoryId,
    category_source: "original",
    categorization_confidence: 0,
    status: transaction.status,
    booked_at: transaction.bookedAt,
    value_at: transaction.valueAt ?? null,
    source: "synced",
    is_internal_transfer: false,
    is_demo: publicProviderMode().environment !== "production",
    provider_metadata: { connection_id: connectionId, reconciled_pending: Boolean(transaction.replacedPendingProviderId) },
    created_at: new Date().toISOString(),
  };
}

export async function synchronizeBankConnection(connectionId: string, trigger: "callback" | "manual" | "scheduled", idempotencyKey = `${trigger}:${connectionId}:${new Date().toISOString().slice(0, 13)}`) {
  const supabase = requireSupabaseAdmin();
  const { data: connectionData, error: connectionError } = await supabase.from("bank_connections").select("*")
    .eq("id", connectionId).eq("workspace_id", DEMO_WORKSPACE_ID).single();
  fail(connectionError, "Could not load the bank connection");
  const connection = connectionData as Row;
  if (["revoked", "expired"].includes(String(connection.status))) throw new BankProviderError("This bank connection requires renewed consent.", 409, false);

  const jobId = id("sync");
  const { error: jobError } = await supabase.from("sync_jobs").insert({
    id: jobId, workspace_id: DEMO_WORKSPACE_ID, bank_connection_id: connectionId,
    idempotency_key: idempotencyKey, trigger, status: "running", started_at: new Date().toISOString(),
  });
  if (jobError?.code === "23505") return { duplicate: true, accountsSynced: 0, transactionsInserted: 0, transactionsUpdated: 0 };
  fail(jobError, "Could not start the synchronization job");
  const { error: syncingError } = await supabase.from("bank_connections").update({ status: "syncing", last_attempted_at: new Date().toISOString() }).eq("id", connectionId);
  fail(syncingError, "Could not mark the bank connection as synchronizing");

  try {
    const provider = createBankDataProvider(String(connection.provider) === "gocardless" ? "gocardless" : "mock");
    const accounts = await provider.fetchAccounts(String(connection.provider_connection_id));
    const { providerToLocal, capturedAt } = await upsertProviderAccounts(connection, accounts);
    const since = connection.last_synced_at ? new Date(new Date(String(connection.last_synced_at)).getTime() - 7 * 86_400_000).toISOString() : undefined;
    const incoming = await provider.fetchTransactions(String(connection.provider_connection_id), since);
    for (const [providerAccountId, localAccountId] of providerToLocal) {
      const pendingAmount = incoming.filter((item) => item.accountId === providerAccountId && item.status === "pending").reduce((sum, item) => sum + item.amountCents, 0);
      const { error: pendingError } = await supabase.from("balance_snapshots").update({ pending_amount_cents: pendingAmount }).eq("workspace_id", DEMO_WORKSPACE_ID).eq("account_id", localAccountId).eq("captured_at", capturedAt);
      fail(pendingError, "Could not save the pending account amount");
    }
    const localAccountIds = [...providerToLocal.values()];
    const { data: existingRows, error: existingError } = localAccountIds.length
      ? await supabase.from("transactions").select("id,account_id,provider_transaction_id,provider_pending_transaction_id,description,amount_cents,currency,status,booked_at").eq("workspace_id", DEMO_WORKSPACE_ID).in("account_id", localAccountIds)
      : { data: [], error: null };
    fail(existingError, "Could not inspect synchronized transactions");
    const existing: StoredBankTransaction[] = (existingRows as Row[]).map((row) => ({
      id: String(row.id), accountId: String(row.account_id), providerTransactionId: row.provider_transaction_id ? String(row.provider_transaction_id) : null,
      providerPendingTransactionId: row.provider_pending_transaction_id ? String(row.provider_pending_transaction_id) : null,
      description: String(row.description), amountCents: Number(row.amount_cents), currency: String(row.currency),
      status: row.status as "pending" | "booked", bookedAt: String(row.booked_at),
    }));
    const plan = reconcileBankTransactions({ workspaceId: DEMO_WORKSPACE_ID, providerAccountToLocal: providerToLocal, existing, incoming });
    const { data: category, error: categoryError } = await supabase.from("categories").select("id").eq("workspace_id", DEMO_WORKSPACE_ID).eq("name", "Outros").single();
    fail(categoryError, "Could not load the fallback transaction category");
    if (!category) throw new Error("The fallback transaction category is missing.");
    const categoryId = String(category.id);

    if (plan.inserts.length) {
      const { error } = await supabase.from("transactions").upsert(plan.inserts.map((item) => transactionRow(item, categoryId, connectionId)), { onConflict: "workspace_id,provider_transaction_id", ignoreDuplicates: true });
      fail(error, "Could not insert synchronized transactions");
    }
    for (const item of plan.updates) {
      const row = transactionRow(item, categoryId, connectionId);
      const { id: _ignoredId, created_at: _ignoredCreatedAt, ...changes } = row;
      void _ignoredId; void _ignoredCreatedAt;
      const { error } = await supabase.from("transactions").update(changes).eq("id", item.localId).eq("workspace_id", DEMO_WORKSPACE_ID);
      fail(error, "Could not reconcile a synchronized transaction");
    }

    const completedAt = new Date();
    const summary = { accountsSynced: accounts.length, transactionsInserted: plan.inserts.length, transactionsUpdated: plan.updates.length };
    const { error: completeError } = await supabase.from("sync_jobs").update({
      status: "completed", accounts_synced: accounts.length, transactions_inserted: plan.inserts.length,
      transactions_updated: plan.updates.length, completed_at: completedAt.toISOString(),
    }).eq("id", jobId);
    fail(completeError, "Could not complete the synchronization job");
    const { error: statusError } = await supabase.from("bank_connections").update({
      status: "connected", last_synced_at: completedAt.toISOString(), next_sync_at: new Date(completedAt.getTime() + SYNC_INTERVAL_MS).toISOString(),
      error_code: null, error_message: null,
    }).eq("id", connectionId);
    fail(statusError, "Could not update the bank connection status");
    await audit("bank.synchronized", connectionId, { trigger, ...summary });
    return { duplicate: false, ...summary };
  } catch (error) {
    const expired = error instanceof BankProviderError && error.status === 401 && /expired|revoked/i.test(error.message);
    const code = error instanceof BankProviderError ? error.code ?? `http_${error.status}` : "sync_failed";
    await supabase.from("sync_jobs").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", jobId);
    await supabase.from("bank_connections").update({ status: expired ? "expired" : "error", error_code: code, error_message: expired ? "O consentimento expirou ou foi revogado. Renove a ligação." : "A instituição está temporariamente indisponível. Tente sincronizar novamente." }).eq("id", connectionId);
    throw error;
  }
}

export async function completeBankCallback(input: { connectionId: string; state: string | null; params: URLSearchParams }) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from("bank_connections").select("*").eq("id", input.connectionId).eq("workspace_id", DEMO_WORKSPACE_ID).single();
  fail(error, "Could not load the callback connection");
  const connection = data as Row;
  if (!callbackStateIsUsable({
    state: input.state, expectedHash: connection.callback_state_hash ? String(connection.callback_state_hash) : null,
    expiresAt: connection.callback_state_expires_at ? String(connection.callback_state_expires_at) : null,
    usedAt: connection.callback_state_used_at ? String(connection.callback_state_used_at) : null,
  })) throw new BankProviderError("The Open Banking callback state is invalid, expired, or already used.", 400, false, "invalid_state");
  input.params.set("providerConnectionId", String(connection.provider_connection_id));
  const provider = createBankDataProvider(String(connection.provider) === "gocardless" ? "gocardless" : "mock");
  const result = await provider.handleCallback(input.params);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from("bank_connections").update({
    status: result.status, callback_state_used_at: now, institution_name: result.institutionName,
    error_code: result.status === "error" ? result.rawStatus ?? "provider_rejected" : null,
  }).eq("id", input.connectionId);
  fail(updateError, "Could not finalize the bank callback");
  if (result.status !== "connected") throw new BankProviderError("The bank did not complete the account consent.", 409, false, result.rawStatus);
  const { error: consentError } = await supabase.from("consents").update({ status: "active", granted_at: now }).eq("bank_connection_id", input.connectionId).eq("status", "pending");
  fail(consentError, "Could not activate the consent metadata");
  await synchronizeBankConnection(input.connectionId, "callback", `callback:${result.id}`);
  await audit("bank.connected", input.connectionId, { provider: connection.provider });
}

export async function renewBankConnection(connectionId: string, appOrigin: string) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from("bank_connections").select("*").eq("id", connectionId).eq("workspace_id", DEMO_WORKSPACE_ID).single();
  fail(error, "Could not load the bank connection");
  const connection = data as Row;
  const state = createCallbackState();
  const callback = buildCallbackUrl(appOrigin, connectionId);
  const provider = createBankDataProvider(String(connection.provider) === "gocardless" ? "gocardless" : "mock");
  const renewed = await provider.refreshConnection(String(connection.provider_connection_id), callback, state);
  const { error: updateError } = await supabase.from("bank_connections").update({
    provider_connection_id: renewed.id, status: renewed.status, callback_state_hash: hashCallbackState(state),
    callback_state_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), callback_state_used_at: renewed.status === "connected" ? new Date().toISOString() : null,
    consent_expires_at: renewed.consentExpiresAt ?? null, error_code: null, error_message: null,
  }).eq("id", connectionId);
  fail(updateError, "Could not save the renewed connection");
  const { error: consentError } = await supabase.from("consents").insert({ id: id("consent"), workspace_id: DEMO_WORKSPACE_ID, bank_connection_id: connectionId, provider_agreement_id: renewed.agreementId ?? null, status: renewed.status === "connected" ? "active" : "pending", granted_at: renewed.status === "connected" ? new Date().toISOString() : null, expires_at: renewed.consentExpiresAt ?? null });
  fail(consentError, "Could not save the renewed consent metadata");
  await audit("bank.consent_renewal_started", connectionId);
  if (renewed.status === "connected") await synchronizeBankConnection(connectionId, "manual", `renew:${renewed.id}`);
  return { redirectUrl: renewed.redirectUrl, status: renewed.status };
}

export async function revokeBankConnection(connectionId: string) {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from("bank_connections").select("provider,provider_connection_id,status").eq("id", connectionId).eq("workspace_id", DEMO_WORKSPACE_ID).single();
  fail(error, "Could not load the bank connection");
  if (!data) throw new Error("The bank connection was not found.");
  const connection = data as Row;
  if (connection.status !== "revoked") {
    const provider = createBankDataProvider(connection.provider === "gocardless" ? "gocardless" : "mock");
    await provider.revokeConsent(String(connection.provider_connection_id));
  }
  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from("bank_connections").update({ status: "revoked", revoked_at: now, next_sync_at: null }).eq("id", connectionId);
  fail(updateError, "Could not revoke the bank connection");
  const { error: consentError } = await supabase.from("consents").update({ status: "revoked", revoked_at: now }).eq("bank_connection_id", connectionId).in("status", ["pending", "active"]);
  fail(consentError, "Could not revoke the consent metadata");
  await audit("bank.revoked", connectionId, { provider: connection.provider });
}

export async function synchronizeDueConnections() {
  const supabase = requireSupabaseAdmin();
  const { data, error } = await supabase.from("bank_connections").select("id").eq("workspace_id", DEMO_WORKSPACE_ID).eq("status", "connected").lte("next_sync_at", new Date().toISOString());
  fail(error, "Could not list due bank connections");
  const results = [];
  for (const connection of data ?? []) results.push(await synchronizeBankConnection(String(connection.id), "scheduled"));
  return results;
}
