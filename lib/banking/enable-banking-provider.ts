import { createHash, sign } from "node:crypto";
import type {
  BankDataProvider,
  BankInstitution,
  ConnectionStatus,
  ProviderAccount,
  ProviderConnection,
  ProviderTransaction,
} from "./provider.ts";
import { decimalAmountToMinorUnits } from "./money.ts";
import { BankProviderError, withProviderResilience } from "./resilience.ts";

const DEFAULT_BASE_URL = "https://api.enablebanking.com";
const MAX_TRANSACTION_PAGES = 100;

type JsonRecord = Record<string, unknown>;

export type EnableBankingConfig = {
  applicationId: string;
  privateKey: string;
  environment: "sandbox" | "production";
  baseUrl?: string;
  accessValidDays?: number;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function encodeInstitutionId(name: string, country: string) {
  return `enablebanking:${Buffer.from(JSON.stringify({ name, country: country.toUpperCase() })).toString("base64url")}`;
}

function decodeInstitutionId(id: string) {
  if (!id.startsWith("enablebanking:")) throw new BankProviderError("The selected Enable Banking institution identifier is invalid.", 400, false, "invalid_institution");
  try {
    const decoded = record(JSON.parse(Buffer.from(id.slice("enablebanking:".length), "base64url").toString("utf8")));
    const name = stringValue(decoded.name);
    const country = stringValue(decoded.country)?.toUpperCase();
    if (!name || !country) throw new Error("Missing institution fields");
    return { name, country };
  } catch {
    throw new BankProviderError("The selected Enable Banking institution identifier is invalid.", 400, false, "invalid_institution");
  }
}

function mapConnectionStatus(status: string | undefined): ConnectionStatus {
  const normalized = status?.toUpperCase();
  if (normalized === "AUTHORIZED") return "connected";
  if (normalized === "EXPIRED") return "expired";
  if (["REVOKED", "CLOSED", "DELETED"].includes(normalized ?? "")) return "revoked";
  if (["REJECTED", "ERROR", "FAILED"].includes(normalized ?? "")) return "error";
  return "requires_action";
}

function accountType(details: JsonRecord): ProviderAccount["type"] {
  const type = String(details.cash_account_type ?? details.cashAccountType ?? details.product ?? "").toUpperCase();
  if (type.includes("SVGS") || type.includes("SAV")) return "savings";
  if (type.includes("CARD") || type.includes("CRDT")) return "credit";
  return "checking";
}

function selectBalance(payload: unknown) {
  const balances = array(record(payload).balances).map(record);
  const type = (item: JsonRecord) => String(item.balance_type ?? item.balanceType ?? item.name ?? "").toUpperCase();
  const booked = balances.find((item) => ["CLBD", "ITBD", "CLAV"].includes(type(item)))
    ?? balances.find((item) => type(item).includes("BOOK"))
    ?? balances[0];
  const available = balances.find((item) => ["ITAV", "CLAV", "OPAV"].includes(type(item)))
    ?? balances.find((item) => type(item).includes("AVAIL"))
    ?? booked;
  const amount = (item: JsonRecord | undefined) => record(item?.balance_amount ?? item?.balanceAmount);
  const bookedAmount = amount(booked);
  const availableAmount = amount(available);
  const currency = stringValue(bookedAmount.currency) ?? stringValue(availableAmount.currency) ?? "EUR";
  return {
    currency,
    bookedBalanceCents: decimalAmountToMinorUnits(stringValue(bookedAmount.amount) ?? "0", currency),
    availableBalanceCents: decimalAmountToMinorUnits(stringValue(availableAmount.amount) ?? stringValue(bookedAmount.amount) ?? "0", currency),
    balanceAsOf: stringValue(booked?.reference_date ?? booked?.referenceDate ?? booked?.last_change_date_time)
      ?? stringValue(available?.reference_date ?? available?.referenceDate ?? available?.last_change_date_time),
  };
}

function accountUid(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const item = record(value);
  return stringValue(item.uid ?? item.id ?? item.account_id);
}

function transactionStatus(transaction: JsonRecord): "pending" | "booked" {
  return String(transaction.status ?? "").toUpperCase() === "BOOK" ? "booked" : "pending";
}

function stableTransactionId(accountId: string, transaction: JsonRecord, status: "pending" | "booked") {
  const providerId = stringValue(transaction.transaction_id ?? transaction.entry_reference);
  if (providerId) return `${accountId}:${providerId}`;
  return `${accountId}:${createHash("sha256").update(JSON.stringify([
    status,
    record(transaction.transaction_amount).amount,
    record(transaction.transaction_amount).currency,
    transaction.booking_date,
    transaction.value_date,
    transaction.remittance_information,
    transaction.note,
  ])).digest("hex")}`;
}

function normalizeTransaction(accountId: string, input: unknown): ProviderTransaction {
  const transaction = record(input);
  const status = transactionStatus(transaction);
  const amount = record(transaction.transaction_amount ?? transaction.transactionAmount);
  const currency = stringValue(amount.currency) ?? "EUR";
  const rawMinor = decimalAmountToMinorUnits(stringValue(amount.amount) ?? "0", currency);
  const indicator = String(transaction.credit_debit_indicator ?? transaction.creditDebitIndicator ?? "").toUpperCase();
  const amountCents = indicator === "DBIT" ? -Math.abs(rawMinor) : indicator === "CRDT" ? Math.abs(rawMinor) : rawMinor;
  const remittance = array(transaction.remittance_information ?? transaction.remittanceInformation)
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" · ");
  const merchant = indicator === "DBIT"
    ? stringValue(record(transaction.creditor).name ?? transaction.creditor_name)
    : stringValue(record(transaction.debtor).name ?? transaction.debtor_name);
  const bankCode = record(transaction.bank_transaction_code);
  const description = remittance
    || stringValue(transaction.note)
    || stringValue(bankCode.description)
    || merchant
    || "Movimento bancário";
  return {
    id: stableTransactionId(accountId, transaction, status),
    accountId,
    description,
    merchant,
    amountCents,
    currency,
    status,
    bookedAt: stringValue(transaction.booking_date ?? transaction.transaction_date ?? transaction.value_date) ?? new Date().toISOString().slice(0, 10),
    valueAt: stringValue(transaction.value_date),
  };
}

export class EnableBankingBankDataProvider implements BankDataProvider {
  private readonly baseUrl: string;
  private readonly config: EnableBankingConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: EnableBankingConfig, fetcher: typeof fetch = fetch) {
    if (!config.applicationId || !config.privateKey) throw new Error("Enable Banking application credentials are not configured.");
    this.config = { ...config, privateKey: config.privateKey.replace(/\\n/g, "\n") };
    this.fetcher = fetcher;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private jwt() {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256", kid: this.config.applicationId })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: issuedAt, exp: issuedAt + 300 })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const signature = sign("RSA-SHA256", Buffer.from(unsigned), this.config.privateKey).toString("base64url");
    return `${unsigned}.${signature}`;
  }

  private async parseResponse(response: Response) {
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const message = stringValue(payload.detail) ?? stringValue(payload.error_description) ?? stringValue(payload.message) ?? `Provider request failed with HTTP ${response.status}.`;
      const code = stringValue(payload.code ?? payload.error);
      throw new BankProviderError(message, response.status, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, code);
    }
    return payload;
  }

  private async request(path: string, init: RequestInit = {}) {
    return withProviderResilience(`enablebanking:${path.split("?")[0]}`, async () => {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.jwt()}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      return this.parseResponse(response);
    });
  }

  async listInstitutions(country: string): Promise<BankInstitution[]> {
    const normalizedCountry = country.toUpperCase();
    const query = new URLSearchParams({ country: normalizedCountry, psu_type: "personal", service: "AIS" });
    const payload = await this.request(`/aspsps?${query}`);
    return array(payload.aspsps).map((value) => {
      const institution = record(value);
      const name = String(institution.name);
      const institutionCountry = String(institution.country ?? normalizedCountry).toUpperCase();
      return {
        id: encodeInstitutionId(name, institutionCountry),
        name,
        country: institutionCountry,
        logoUrl: stringValue(institution.logo),
      };
    });
  }

  private async aspsp(institutionId: string) {
    const selected = decodeInstitutionId(institutionId);
    const query = new URLSearchParams({ country: selected.country, psu_type: "personal", service: "AIS" });
    const payload = await this.request(`/aspsps?${query}`);
    const institution = array(payload.aspsps).map(record).find((item) => item.name === selected.name);
    if (!institution) throw new BankProviderError("The selected institution is no longer available through Enable Banking.", 404, false, "institution_unavailable");
    return institution;
  }

  private async startAuthorization(institutionId: string, redirectUri: string, state: string): Promise<ProviderConnection> {
    const selected = decodeInstitutionId(institutionId);
    const institution = await this.aspsp(institutionId);
    const requestedSeconds = (this.config.accessValidDays ?? 90) * 86_400;
    const providerMaximum = numberValue(institution.maximum_consent_validity);
    const validitySeconds = providerMaximum && providerMaximum > 0 ? Math.min(requestedSeconds, providerMaximum) : requestedSeconds;
    const validUntil = new Date(Date.now() + validitySeconds * 1000).toISOString();
    const authorization = await this.request("/auth", {
      method: "POST",
      body: JSON.stringify({
        access: { valid_until: validUntil, balances: true, transactions: true },
        aspsp: { name: selected.name, country: selected.country },
        state,
        redirect_url: redirectUri,
        psu_type: "personal",
        language: "pt",
      }),
    });
    const authorizationId = stringValue(authorization.authorization_id);
    const redirectUrl = stringValue(authorization.url);
    if (!authorizationId || !redirectUrl) throw new BankProviderError("Enable Banking did not return an authorization URL.", 502, true, "invalid_authorization_response");
    return {
      id: authorizationId,
      institutionId,
      institutionName: selected.name,
      status: "requires_action",
      redirectUrl,
      consentExpiresAt: validUntil,
      consentId: authorizationId,
      rawStatus: "PENDING_AUTHORIZATION",
    };
  }

  async createConnection(institutionId: string, redirectUri: string, state: string): Promise<ProviderConnection> {
    return this.startAuthorization(institutionId, redirectUri, state);
  }

  async handleCallback(params: URLSearchParams): Promise<ProviderConnection> {
    const providerError = params.get("error");
    if (providerError) throw new BankProviderError(params.get("error_description") ?? "The bank rejected the account authorization.", 409, false, providerError);
    const code = params.get("code");
    if (!code) throw new BankProviderError("The Enable Banking callback code is missing.", 400, false, "missing_callback_code");
    const session = await this.request("/sessions", { method: "POST", body: JSON.stringify({ code }) });
    const sessionId = stringValue(session.session_id);
    if (!sessionId) throw new BankProviderError("Enable Banking did not return a session identifier.", 502, true, "invalid_session_response");
    const aspsp = record(session.aspsp);
    const name = stringValue(aspsp.name) ?? "Instituição bancária";
    const country = stringValue(aspsp.country)?.toUpperCase() ?? "PT";
    return {
      id: sessionId,
      institutionId: encodeInstitutionId(name, country),
      institutionName: name,
      status: "connected",
      consentId: params.get("providerConnectionId") ?? undefined,
      consentExpiresAt: stringValue(record(session.access).valid_until),
      rawStatus: "AUTHORIZED",
    };
  }

  private async session(connectionId: string) {
    return this.request(`/sessions/${encodeURIComponent(connectionId)}`);
  }

  private async accountIds(connectionId: string) {
    const session = await this.session(connectionId);
    const status = mapConnectionStatus(stringValue(session.status));
    if (status === "expired" || status === "revoked") throw new BankProviderError("The Enable Banking session has expired or been revoked.", 401, false, stringValue(session.status));
    return array(session.accounts).map(accountUid).filter((value): value is string => Boolean(value));
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const ids = await this.accountIds(connectionId);
    return Promise.all(ids.map(async (id) => {
      const [detailsPayload, balancesPayload] = await Promise.all([
        this.request(`/accounts/${encodeURIComponent(id)}/details`),
        this.request(`/accounts/${encodeURIComponent(id)}/balances`),
      ]);
      const details = record(detailsPayload.account ?? detailsPayload);
      const balances = selectBalance(balancesPayload);
      const identifier = stringValue(details.iban ?? details.bban);
      return {
        id,
        name: stringValue(details.name ?? details.product) ?? "Conta bancária",
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

  private async accountTransactions(accountId: string, since?: string) {
    const transactions: ProviderTransaction[] = [];
    let continuationKey: string | undefined;
    for (let page = 0; page < MAX_TRANSACTION_PAGES; page += 1) {
      const query = new URLSearchParams();
      if (since) query.set("date_from", since.slice(0, 10));
      if (continuationKey) query.set("continuation_key", continuationKey);
      const payload = await this.request(`/accounts/${encodeURIComponent(accountId)}/transactions${query.size ? `?${query}` : ""}`);
      transactions.push(...array(payload.transactions).map((item) => normalizeTransaction(accountId, item)));
      continuationKey = stringValue(payload.continuation_key);
      if (!continuationKey) return transactions;
    }
    throw new BankProviderError("Enable Banking transaction pagination exceeded the safety limit.", 502, false, "pagination_limit");
  }

  async fetchTransactions(connectionId: string, since?: string): Promise<ProviderTransaction[]> {
    const ids = await this.accountIds(connectionId);
    return (await Promise.all(ids.map((accountId) => this.accountTransactions(accountId, since)))).flat();
  }

  async refreshConnection(connectionId: string, redirectUri?: string, state?: string, institutionId?: string): Promise<ProviderConnection> {
    if (!redirectUri || !state) throw new BankProviderError("A callback URL and state are required to renew consent.", 400, false);
    if (institutionId) return this.startAuthorization(institutionId, redirectUri, state);
    const session = await this.session(connectionId);
    const aspsp = record(session.aspsp);
    const name = stringValue(aspsp.name);
    const country = stringValue(aspsp.country);
    if (!name || !country) throw new BankProviderError("The institution could not be recovered for consent renewal.", 409, false, "missing_aspsp");
    return this.startAuthorization(encodeInstitutionId(name, country), redirectUri, state);
  }

  async revokeConsent(connectionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
  }
}
