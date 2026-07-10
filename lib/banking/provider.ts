export type ConnectionStatus =
  | "connected"
  | "syncing"
  | "requires_action"
  | "expired"
  | "revoked"
  | "error";

export interface BankInstitution {
  id: string;
  name: string;
  country: string;
  logoUrl?: string;
}

export interface ProviderConnection {
  id: string;
  institutionId: string;
  institutionName: string;
  status: ConnectionStatus;
  redirectUrl?: string;
  consentExpiresAt?: string;
}

export interface ProviderAccount {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit";
  currency: string;
  bookedBalanceCents: number;
  availableBalanceCents: number;
}

export interface ProviderTransaction {
  id: string;
  accountId: string;
  description: string;
  merchant?: string;
  amountCents: number;
  currency: string;
  status: "pending" | "booked";
  bookedAt: string;
}

export interface BankDataProvider {
  listInstitutions(country: string): Promise<BankInstitution[]>;
  createConnection(institutionId: string, redirectUri: string, state: string): Promise<ProviderConnection>;
  handleCallback(params: URLSearchParams): Promise<ProviderConnection>;
  fetchAccounts(connectionId: string): Promise<ProviderAccount[]>;
  fetchBalances(connectionId: string, accountIds: string[]): Promise<ProviderAccount[]>;
  fetchTransactions(connectionId: string, since?: string): Promise<ProviderTransaction[]>;
  refreshConnection(connectionId: string): Promise<ProviderConnection>;
  revokeConsent(connectionId: string): Promise<void>;
}

const DEMO_INSTITUTIONS: BankInstitution[] = [
  { id: "pt-demo-atlantico", name: "Banco Atlântico — Sandbox", country: "PT" },
  { id: "pt-demo-lusitano", name: "Banco Lusitano — Sandbox", country: "PT" },
  { id: "es-demo-sol", name: "Banco del Sol — Sandbox", country: "ES" },
];

export class MockBankDataProvider implements BankDataProvider {
  async listInstitutions(country: string) {
    return DEMO_INSTITUTIONS.filter((institution) => institution.country === country);
  }

  async createConnection(institutionId: string, _redirectUri: string, _state: string) {
    void _redirectUri;
    void _state;
    const institution = DEMO_INSTITUTIONS.find((item) => item.id === institutionId);
    if (!institution) throw new Error("Instituição de demonstração desconhecida.");
    return {
      id: `mock-${institutionId}`,
      institutionId,
      institutionName: institution.name,
      status: "connected" as const,
      consentExpiresAt: "2026-10-08T12:00:00.000Z",
    };
  }

  async handleCallback(params: URLSearchParams) {
    return this.createConnection(params.get("institutionId") ?? "pt-demo-atlantico", "", "");
  }

  async fetchAccounts(_connectionId: string) {
    void _connectionId;
    return [
      { id: "mock-daily", name: "Conta Dia-a-dia", type: "checking" as const, currency: "EUR", bookedBalanceCents: 246810, availableBalanceCents: 239610 },
      { id: "mock-reserve", name: "Reserva", type: "savings" as const, currency: "EUR", bookedBalanceCents: 430000, availableBalanceCents: 430000 },
    ];
  }

  async fetchBalances(connectionId: string, accountIds: string[]) {
    const accounts = await this.fetchAccounts(connectionId);
    return accounts.filter((account) => accountIds.includes(account.id));
  }

  async fetchTransactions(_connectionId: string, _since?: string) {
    void _connectionId;
    void _since;
    return [
      { id: "mock-tx-coffee", accountId: "mock-daily", description: "Fábrica Coffee Roasters", merchant: "Fábrica Coffee Roasters", amountCents: -420, currency: "EUR", status: "booked" as const, bookedAt: "2026-07-09" },
      { id: "mock-tx-pharmacy", accountId: "mock-daily", description: "Farmácia Central", merchant: "Farmácia Central", amountCents: -1865, currency: "EUR", status: "pending" as const, bookedAt: "2026-07-10" },
    ];
  }

  async refreshConnection(connectionId: string) {
    return {
      id: connectionId,
      institutionId: "pt-demo-atlantico",
      institutionName: "Banco Atlântico — Sandbox",
      status: "connected" as const,
      consentExpiresAt: "2026-10-08T12:00:00.000Z",
    };
  }

  async revokeConsent(_connectionId: string) {
    void _connectionId;
  }
}
