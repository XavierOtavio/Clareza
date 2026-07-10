import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["personal", "family"] }).notNull().default("personal"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["checking", "savings", "credit", "cash", "investment", "loan"] }).notNull(),
    source: text("source", { enum: ["synced", "manual", "imported"] }).notNull(),
    institutionName: text("institution_name"),
    currency: text("currency").notNull().default("EUR"),
    balanceCents: integer("balance_cents").notNull(),
    availableBalanceCents: integer("available_balance_cents"),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("accounts_workspace_idx").on(table.workspaceId)]
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    providerTransactionId: text("provider_transaction_id"),
    description: text("description").notNull(),
    merchant: text("merchant"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    category: text("category").notNull(),
    status: text("status", { enum: ["pending", "booked"] }).notNull(),
    bookedAt: text("booked_at").notNull(),
    isInternalTransfer: integer("is_internal_transfer", { mode: "boolean" }).notNull().default(false),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("transactions_workspace_date_idx").on(table.workspaceId, table.bookedAt),
    uniqueIndex("transactions_provider_unique").on(table.workspaceId, table.providerTransactionId),
  ]
);

export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    limitCents: integer("limit_cents").notNull(),
    month: text("month").notNull(),
    rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("budgets_workspace_category_month_unique").on(table.workspaceId, table.category, table.month),
  ]
);

export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetCents: integer("target_cents").notNull(),
    currentCents: integer("current_cents").notNull().default(0),
    targetDate: text("target_date"),
    priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  },
  (table) => [index("goals_workspace_idx").on(table.workspaceId)]
);

export const bankConnections = sqliteTable(
  "bank_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    institutionId: text("institution_id").notNull(),
    institutionName: text("institution_name").notNull(),
    status: text("status", { enum: ["connected", "syncing", "requires_action", "expired", "revoked", "error"] }).notNull(),
    lastSyncedAt: text("last_synced_at"),
    consentExpiresAt: text("consent_expires_at"),
  },
  (table) => [uniqueIndex("connections_workspace_institution_unique").on(table.workspaceId, table.institutionId)]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: text("metadata"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("audit_workspace_date_idx").on(table.workspaceId, table.createdAt)]
);
