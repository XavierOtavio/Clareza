import { createHash, randomUUID } from "node:crypto";
import type {
  BankDataProvider,
  BankInstitution,
  ConnectionStatus,
  ProviderAccount,
  ProviderConnection,
  ProviderTransaction,
} from "./provider.ts";
import { SANDBOX_FINANCE_INSTITUTION } from "./provider.ts";
import { decimalAmountToMinorUnits } from "./money.ts";
import { BankProviderError, withProviderResilience } from "./resilience.ts";

const DEFAULT_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";

type JsonRecord = Record<string, unknown>;

export type GoCardlessConfig = {
  secretId: string;
  secretKey: string;
  environment: "sandbox" | "production";
  baseUrl?: string;
  accessValidDays?: number;
  historicalDays?: number;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function mapConnectionStatus(status: string | undefined): ConnectionStatus {
  if (status === "LN") return "connected";
  if (status === "EX") return "expired";
  if (status === "RJ" || status === "SU") return "error";
  return "requires_action";
}

function accountType(details: JsonRecord): ProviderAccount["type"] {
  const type = String(details.cashAccountType ?? details.product ?? "").toUpperCase();
  if (type.includes("SVGS") || type.includes("SAV")) return "savings";
  if (type.includes("CARD") || type.includes("CRDT")) return "credit";
  return "checking";
}

function selectBalance(payload: unknown) {
  const balances = Array.isArray(record(payload).balances) ? record(payload).balances as unknown[] : [];
  const normalized = balances.map((item) => record(item));
  const booked = normalized.find((item) => String(item.balanceType).toLowerCase().includes("booked")) ?? normalized[0];
  const available = normalized.find((item) => String(item.balanceType).toLowerCase().includes("available")) ?? booked;
  const amount = (item: JsonRecord | undefined) => record(item?.balanceAmount);
  const bookedAmount = amount(booked);
  const availableAmount = amount(available);
  const currency = stringValue(bookedAmount.currency) ?? stringValue(availableAmount.currency) ?? "EUR";
  return {
    currency,
    bookedBalanceCents: decimalAmountToMinorUnits(stringValue(bookedAmount.amount) ?? "0", currency),
    availableBalanceCents: decimalAmountToMinorUnits(stringValue(availableAmount.amount) ?? stringValue(bookedAmount.amount) ?? "0", currency),
    balanceAsOf: stringValue(booked?.referenceDate) ?? stringValue(available?.referenceDate),
  };
}

function stableTransactionId(accountId: string, transaction: JsonRecord, status: "pending" | "booked") {
  const providerId = stringValue(transaction.transactionId) ?? stringValue(transaction.internalTransactionId);
  if (providerId) return `${accountId}:${providerId}`;
  return createHash("sha256").update(JSON.stringify([
    accountId,
    status,
    record(transaction.transactionAmount).amount,
    record(transaction.transactionAmount).currency,
    transaction.bookingDate,
    transaction.valueDate,
    transaction.remittanceInformationUnstructured,
    transaction.remittanceInformationUnstructuredArray,
  ])).digest("hex");
}

function normalizeTransaction(accountId: string, input: unknown, status: "pending" | "booked"): ProviderTransaction {
  const transaction = record(input);
  const amount = record(transaction.transactionAmount);
  const currency = stringValue(amount.currency) ?? "EUR";
  const remittanceArray = Array.isArray(transaction.remittanceInformationUnstructuredArray)
    ? transaction.remittanceInformationUnstructuredArray.filter((item): item is string => typeof item === "string").join(" · ")
    : undefined;
  const merchant = stringValue(transaction.creditorName) ?? stringValue(transaction.debtorName);
  const description = stringValue(transaction.remittanceInformationUnstructured)
    ?? remittanceArray
    ?? stringValue(transaction.additionalInformation)
    ?? merchant
    ?? "Movimento bancário";
  return {
    id: stableTransactionId(accountId, transaction, status),
    accountId,
    description,
    merchant,
    amountCents: decimalAmountToMinorUnits(stringValue(amount.amount) ?? "0", currency),
    currency,
    status,
    bookedAt: stringValue(transaction.bookingDate) ?? stringValue(transaction.valueDate) ?? stringValue(transaction.requestedExecutionDate) ?? new Date().toISOString().slice(0, 10),
    valueAt: stringValue(transaction.valueDate),
    pendingTransactionId: stringValue(transaction.pendingTransactionId) ? `${accountId}:${String(transaction.pendingTransactionId)}` : undefined,
  };
}

export class GoCardlessBankDataProvider implements BankDataProvider {
  private accessToken?: { value: string; expiresAt: number };
  private readonly baseUrl: string;
  private readonly config: GoCardlessConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: GoCardlessConfig, fetcher: typeof fetch = fetch) {
    if (!config.secretId || !config.secretKey) throw new Error("GoCardless Bank Account Data credentials are not configured.");
    this.config = config;
    this.fetcher = fetcher;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async parseResponse(response: Response) {
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const message = stringValue(payload.detail) ?? stringValue(payload.summary) ?? `Provider request failed with HTTP ${response.status}.`;
      const code = stringValue(payload.summary);
      throw new BankProviderError(message, response.status, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, code);
    }
    return payload;
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const response = await withProviderResilience("gocardless:token", () => this.fetcher(`${this.baseUrl}/token/new/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ secret_id: this.config.secretId, secret_key: this.config.secretKey }),
    }).then((result) => this.parseResponse(result)));
    const value = stringValue(response.access);
    if (!value) throw new BankProviderError("The provider did not return an access token.", 502, true);
    this.accessToken = { value, expiresAt: Date.now() + Number(response.access_expires ?? 86_400) * 1000 };
    return value;
  }

  private async request(path: string, init: RequestInit = {}) {
    return withProviderResilience(`gocardless:${path.split("?")[0]}`, async () => {
      const token = await this.token();
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      });
      if (response.status === 401) {
        this.accessToken = undefined;
        throw new BankProviderError("The provider access token must be refreshed.", 401, true, "access_token_expired");
      }
      return this.parseResponse(response);
    });
  }

  async listInstitutions(country: string): Promise<BankInstitution[]> {
    if (this.config.environment === "sandbox") return [{ ...SANDBOX_FINANCE_INSTITUTION, country: country.toUpperCase() }];
    const payload = await this.request(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`);
    const institutions = Array.isArray(payload) ? payload : Object.values(payload).filter((value) => record(value).id);
    return institutions.map((item) => {
      const institution = record(item);
      return {
        id: String(institution.id),
        name: String(institution.name),
        country: country.toUpperCase(),
        logoUrl: stringValue(institution.logo),
      };
    });
  }

  private async institution(institutionId: string) {
    if (institutionId === SANDBOX_FINANCE_INSTITUTION.id) return SANDBOX_FINANCE_INSTITUTION;
    const institution = await this.request(`/institutions/${encodeURIComponent(institutionId)}/`);
    return { id: institutionId, name: String(institution.name ?? institutionId), country: "" };
  }

  async createConnection(institutionId: string, redirectUri: string, state: string): Promise<ProviderConnection> {
    const validDays = this.config.accessValidDays ?? 90;
    const agreement = await this.request("/agreements/enduser/", {
      method: "POST",
      body: JSON.stringify({
        institution_id: institutionId,
        max_historical_days: this.config.historicalDays ?? 90,
        access_valid_for_days: validDays,
        access_scope: ["balances", "details", "transactions"],
      }),
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", state);
    const requisition = await this.request("/requisitions/", {
      method: "POST",
      body: JSON.stringify({
        redirect: callback.toString(),
        institution_id: institutionId,
        reference: randomUUID(),
        agreement: agreement.id,
        user_language: "PT",
      }),
    });
    const institution = await this.institution(institutionId);
    return {
      id: String(requisition.id),
      institutionId,
      institutionName: institution.name,
      status: mapConnectionStatus(stringValue(requisition.status)),
      rawStatus: stringValue(requisition.status),
      redirectUrl: stringValue(requisition.link),
      agreementId: stringValue(agreement.id),
      consentExpiresAt: new Date(Date.now() + validDays * 86_400_000).toISOString(),
    };
  }

  async handleCallback(params: URLSearchParams): Promise<ProviderConnection> {
    const connectionId = params.get("providerConnectionId");
    if (!connectionId) throw new BankProviderError("The provider connection identifier is missing.", 400, false);
    const requisition = await this.request(`/requisitions/${encodeURIComponent(connectionId)}/`);
    const institutionId = String(requisition.institution_id ?? "");
    const institution = await this.institution(institutionId);
    return {
      id: connectionId,
      institutionId,
      institutionName: institution.name,
      status: mapConnectionStatus(stringValue(requisition.status)),
      rawStatus: stringValue(requisition.status),
    };
  }

  private async accountIds(connectionId: string) {
    const requisition = await this.request(`/requisitions/${encodeURIComponent(connectionId)}/`);
    return Array.isArray(requisition.accounts) ? requisition.accounts.map(String) : [];
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const ids = await this.accountIds(connectionId);
    return Promise.all(ids.map(async (id) => {
      const [detailsPayload, balancesPayload] = await Promise.all([
        this.request(`/accounts/${encodeURIComponent(id)}/details/`),
        this.request(`/accounts/${encodeURIComponent(id)}/balances/`),
      ]);
      const details = record(detailsPayload.account);
      const balances = selectBalance(balancesPayload);
      const identifier = stringValue(details.iban) ?? stringValue(details.bban);
      return {
        id,
        name: stringValue(details.name) ?? stringValue(details.product) ?? "Conta bancária",
        type: accountType(details),
        ...balances,
        maskedIdentifier: identifier ? `•••• ${identifier.slice(-4)}` : undefined,
      };
    }));
  }

  async fetchBalances(connectionId: string, accountIds: string[]): Promise<ProviderAccount[]> {
    const accounts = await this.fetchAccounts(connectionId);
    return accounts.filter((account) => accountIds.includes(account.id));
  }

  async fetchTransactions(connectionId: string, since?: string): Promise<ProviderTransaction[]> {
    const ids = await this.accountIds(connectionId);
    const query = since ? `?date_from=${encodeURIComponent(since.slice(0, 10))}` : "";
    const groups = await Promise.all(ids.map(async (accountId) => {
      const payload = await this.request(`/accounts/${encodeURIComponent(accountId)}/transactions/${query}`);
      const transactions = record(payload.transactions);
      const booked = Array.isArray(transactions.booked) ? transactions.booked.map((item) => normalizeTransaction(accountId, item, "booked")) : [];
      const pending = Array.isArray(transactions.pending) ? transactions.pending.map((item) => normalizeTransaction(accountId, item, "pending")) : [];
      return [...booked, ...pending];
    }));
    return groups.flat();
  }

  async refreshConnection(connectionId: string, redirectUri?: string, state?: string): Promise<ProviderConnection> {
    if (!redirectUri || !state) throw new BankProviderError("A callback URL and state are required to renew consent.", 400, false);
    const requisition = await this.request(`/requisitions/${encodeURIComponent(connectionId)}/`);
    return this.createConnection(String(requisition.institution_id), redirectUri, state);
  }

  async revokeConsent(connectionId: string): Promise<void> {
    await this.request(`/requisitions/${encodeURIComponent(connectionId)}/`, { method: "DELETE" });
  }
}
