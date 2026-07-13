"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { calculateMetrics, parseMoneyToCents } from "@/lib/finance/calculations";
import { parseCsvText, suggestCsvColumnMapping, type CsvColumnMapping, type ParsedCsv } from "@/lib/transactions/csv";

type View = "overview" | "accounts" | "transactions" | "budgets" | "planning" | "wealth" | "reports" | "settings";
type Modal = "account" | "bank" | "budget" | "goal" | "accountDetails" | "transaction" | "csvImport" | "rule" | "category" | null;

type Account = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "cash" | "investment" | "loan";
  source: "synced" | "manual" | "imported";
  institutionName?: string | null;
  currency: string;
  balanceCents: number;
  availableBalanceCents?: number | null;
  isHidden: number | boolean;
};

type Transaction = {
  id: string;
  accountId: string;
  description: string;
  merchant?: string | null;
  amountCents: number;
  currency: string;
  category: string;
  categoryId?: string | null;
  categorySource?: "original" | "rule" | "user";
  categorizationConfidence?: number | null;
  status: "pending" | "booked";
  bookedAt: string;
  source?: "synced" | "manual" | "imported";
  isInternalTransfer: number | boolean;
};

type Category = { id: string; name: string; kind: "expense" | "income" | "transfer"; isSystem: boolean };
type CategorizationRule = { id: string; name: string; field: "description" | "merchant"; operator: "contains" | "equals" | "starts_with"; pattern: string; categoryId: string; categoryName: string; priority: number; isActive: boolean };
type ImportJob = { id: string; fileName: string; status: string; totalRows: number; importedRows: number; duplicateRows: number; invalidRows: number; createdAt: string };
type Budget = { id: string; category: string; limitCents: number; month: string; rollover: number | boolean };
type Goal = { id: string; name: string; targetCents: number; currentCents: number; targetDate?: string | null; priority: "low" | "medium" | "high" };
type Connection = { id: string; provider: string; country?: string; institutionId: string; institutionName: string; status: string; lastSyncedAt?: string | null; nextSyncAt?: string | null; consentExpiresAt?: string | null; errorCode?: string | null; errorMessage?: string | null };
type BankInstitution = { id: string; name: string; country: string; logoUrl?: string };
type BankProviderMode = { provider: "mock" | "gocardless"; environment: "demo" | "sandbox" | "production"; realBankDataEnabled: boolean };

type FinanceState = {
  mode: "demo";
  asOf: string;
  workspace: { id: string; name: string; type: string; isDemo: number | boolean };
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: CategorizationRule[];
  imports: ImportJob[];
  budgets: Budget[];
  goals: Goal[];
  connections: Connection[];
};

type ActionPayload = Record<string, unknown> & { type: string };

const FALLBACK_STATE: FinanceState = {
  mode: "demo",
  asOf: "2026-07-10T10:42:00.000Z",
  workspace: { id: "demo-workspace", name: "Finanças da família", type: "family", isDemo: true },
  accounts: [
    { id: "acc-main", name: "Conta principal", type: "checking", source: "synced", institutionName: "Banco Atlântico", currency: "EUR", balanceCents: 381245, availableBalanceCents: 367120, isHidden: false },
    { id: "acc-savings", name: "Poupança", type: "savings", source: "synced", institutionName: "Banco Atlântico", currency: "EUR", balanceCents: 914580, availableBalanceCents: 914580, isHidden: false },
    { id: "acc-card", name: "Cartão Universo", type: "credit", source: "synced", institutionName: "Universo", currency: "EUR", balanceCents: -84215, availableBalanceCents: -84215, isHidden: false },
    { id: "acc-cash", name: "Dinheiro", type: "cash", source: "manual", institutionName: null, currency: "EUR", balanceCents: 12500, availableBalanceCents: 12500, isHidden: false },
  ],
  transactions: [
    { id: "tx-gym", accountId: "acc-card", description: "Fitness Hut", merchant: "Fitness Hut", amountCents: -2990, currency: "EUR", category: "Saúde", status: "pending", bookedAt: "2026-07-10", isInternalTransfer: false },
    { id: "tx-transfer", accountId: "acc-main", description: "Transferência para poupança", merchant: "Transferência interna", amountCents: -25000, currency: "EUR", category: "Transferência", status: "booked", bookedAt: "2026-07-09", isInternalTransfer: true },
    { id: "tx-restaurant", accountId: "acc-card", description: "Mesa de Lemos", merchant: "Mesa de Lemos", amountCents: -6850, currency: "EUR", category: "Restaurantes", status: "booked", bookedAt: "2026-07-08", isInternalTransfer: false },
    { id: "tx-fuel", accountId: "acc-card", description: "Galp Viseu", merchant: "Galp", amountCents: -4872, currency: "EUR", category: "Transportes", status: "booked", bookedAt: "2026-07-07", isInternalTransfer: false },
    { id: "tx-edp", accountId: "acc-main", description: "EDP Comercial", merchant: "EDP", amountCents: -6210, currency: "EUR", category: "Casa", status: "booked", bookedAt: "2026-07-06", isInternalTransfer: false },
    { id: "tx-continente", accountId: "acc-card", description: "Continente Modelo Viseu", merchant: "Continente", amountCents: -8734, currency: "EUR", category: "Supermercado", status: "booked", bookedAt: "2026-07-05", isInternalTransfer: false },
    { id: "tx-rent", accountId: "acc-main", description: "Renda de casa", merchant: "Senhorio", amountCents: -78000, currency: "EUR", category: "Habitação", status: "booked", bookedAt: "2026-07-02", isInternalTransfer: false },
    { id: "tx-salary", accountId: "acc-main", description: "Salário", merchant: "Deloitte", amountCents: 248500, currency: "EUR", category: "Rendimentos", status: "booked", bookedAt: "2026-07-01", isInternalTransfer: false },
  ],
  categories: [
    { id: "category-home", name: "Casa", kind: "expense", isSystem: true },
    { id: "category-housing", name: "Habitação", kind: "expense", isSystem: true },
    { id: "category-grocery", name: "Supermercado", kind: "expense", isSystem: true },
    { id: "category-transport", name: "Transportes", kind: "expense", isSystem: true },
    { id: "category-restaurants", name: "Restaurantes", kind: "expense", isSystem: true },
    { id: "category-health", name: "Saúde", kind: "expense", isSystem: true },
    { id: "category-education", name: "Educação", kind: "expense", isSystem: true },
    { id: "category-leisure", name: "Lazer", kind: "expense", isSystem: true },
    { id: "category-income", name: "Rendimentos", kind: "income", isSystem: true },
    { id: "category-transfer", name: "Transferência", kind: "transfer", isSystem: true },
    { id: "category-other", name: "Outros", kind: "expense", isSystem: true },
  ],
  rules: [],
  imports: [],
  budgets: [
    { id: "budget-home", category: "Habitação", limitCents: 85000, month: "2026-07", rollover: false },
    { id: "budget-market", category: "Supermercado", limitCents: 30000, month: "2026-07", rollover: false },
    { id: "budget-transport", category: "Transportes", limitCents: 15000, month: "2026-07", rollover: false },
    { id: "budget-restaurants", category: "Restaurantes", limitCents: 12000, month: "2026-07", rollover: false },
  ],
  goals: [
    { id: "goal-emergency", name: "Fundo de emergência", targetCents: 900000, currentCents: 580000, targetDate: "2027-02-28", priority: "high" },
    { id: "goal-holiday", name: "Férias em família", targetCents: 180000, currentCents: 73500, targetDate: "2027-06-01", priority: "medium" },
  ],
  connections: [{ id: "connection-demo", provider: "mock", institutionId: "pt-demo-lusitano", institutionName: "Banco Lusitano — Demonstração", status: "connected", lastSyncedAt: "2026-07-10T10:42:00.000Z", consentExpiresAt: "2026-09-27T23:59:59.000Z" }],
};

const NAVIGATION: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Visão geral", icon: "overview" },
  { id: "accounts", label: "Contas", icon: "wallet" },
  { id: "transactions", label: "Movimentos", icon: "transactions" },
  { id: "budgets", label: "Orçamentos", icon: "budget" },
  { id: "planning", label: "Planeamento", icon: "target" },
  { id: "wealth", label: "Património", icon: "wealth" },
  { id: "reports", label: "Relatórios", icon: "report" },
  { id: "settings", label: "Definições", icon: "settings" },
];

const VIEW_TITLES: Record<View, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Sexta-feira, 10 de Julho", title: "Bom dia", description: "A sua posição financeira, sem misturar factos com previsões." },
  accounts: { eyebrow: "Contas e ligações", title: "O seu dinheiro", description: "Saldos contabilísticos, disponíveis e fontes devidamente separados." },
  transactions: { eyebrow: "Movimentos", title: "Cada euro explicado", description: "Consulte, filtre e corrija a classificação dos seus movimentos." },
  budgets: { eyebrow: "Julho de 2026", title: "Orçamentos", description: "Compare o planeado com o que já foi efectivamente realizado." },
  planning: { eyebrow: "Planeamento", title: "Objectivos com horizonte", description: "Transforme intenções em metas mensuráveis, sem promessas mágicas." },
  wealth: { eyebrow: "Património", title: "Activos menos passivos", description: "Uma fotografia datada do que possui e do que deve." },
  reports: { eyebrow: "Relatórios", title: "Números auditáveis", description: "Resumos claros com acesso aos movimentos que sustentam cada total." },
  settings: { eyebrow: "Definições", title: "Controlo e privacidade", description: "Preferências do espaço, dados e ligações num só lugar." },
};

function formatMoney(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", withTime ? { dateStyle: "short", timeStyle: "short" } : { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function moneyInputToCents(value: FormDataEntryValue | null) {
  return parseMoneyToCents(String(value ?? ""));
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "Tiago";
}

export function FinanceApp({ viewer }: { viewer: { name: string; email: string } }) {
  const [data, setData] = useState<FinanceState | null>(null);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/finance", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("A persistência está temporariamente indisponível.");
        return (await response.json()) as FinanceState;
      })
      .then((state) => {
        if (!active) return;
        setData(state);
        const callback = new URLSearchParams(window.location.search);
        if (callback.get("bank") === "connected") {
          setView("accounts");
          setToast("Ligação autorizada e primeira sincronização concluída.");
          window.history.replaceState({}, "", window.location.pathname);
        } else if (callback.get("bank") === "error") {
          setView("accounts");
          setError(callback.get("reason") || "Não foi possível concluir a autorização bancária.");
          window.history.replaceState({}, "", window.location.pathname);
        }
      })
      .catch((loadError: Error) => {
        if (!active) return;
        setData(FALLBACK_STATE);
        setError(`${loadError.message} Os dados locais de demonstração continuam disponíveis.`);
      });

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const savedTheme = localStorage.getItem("clareza-theme");
    if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const metrics = useMemo(() => calculateMetrics(data ?? FALLBACK_STATE), [data]);
  const alerts = useMemo(() => buildAlerts(data ?? FALLBACK_STATE, metrics).filter((item) => !dismissedAlerts.includes(item.id)), [data, metrics, dismissedAlerts]);

  async function perform(action: ActionPayload, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const payload = await response.json() as FinanceState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível guardar a alteração.");
      setData(payload);
      setModal(null);
      setToast(successMessage);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Ocorreu um erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadFinanceState() {
    const response = await fetch("/api/finance", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível actualizar os dados financeiros.");
    setData(await response.json() as FinanceState);
  }

  async function connectBank(country: string, institutionId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/banking/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country, institutionId }) });
      const payload = await response.json() as { redirectUrl?: string; error?: string; environment?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível iniciar a ligação bancária.");
      if (payload.redirectUrl) {
        window.location.assign(payload.redirectUrl);
        return;
      }
      await reloadFinanceState();
      setModal(null);
      setToast(payload.environment === "demo" ? "Banco de demonstração ligado e sincronizado." : "Ligação sincronizada.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Ocorreu um erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function manageConnection(connectionId: string, action: "sync" | "renew") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/banking/connections/${encodeURIComponent(connectionId)}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${action}:${connectionId}:${crypto.randomUUID()}` }, body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { redirectUrl?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível actualizar a ligação.");
      if (payload.redirectUrl) {
        window.location.assign(payload.redirectUrl);
        return;
      }
      await reloadFinanceState();
      setToast(action === "sync" ? "Sincronização concluída." : "Consentimento renovado.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Ocorreu um erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectBank(connectionId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/banking/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "Não foi possível revogar a ligação.");
      }
      await reloadFinanceState();
      setToast("Consentimento revogado e sincronizações interrompidas.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Ocorreu um erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  function changeView(next: View) {
    setView(next);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTheme() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = "dark";
    localStorage.setItem("clareza-theme", dark ? "light" : "dark");
  }

  function openAccount(account: Account) {
    setSelectedAccount(account);
    setModal("accountDetails");
  }

  if (!data) return <LoadingShell />;

  const heading = VIEW_TITLES[view];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Saltar para o conteúdo</a>
      <Sidebar activeView={view} viewer={viewer} onNavigate={changeView} />

      <main className="main-area" id="main-content">
        <div className="mobile-topbar">
          <Brand compact />
          <span className="demo-pill"><span /> Demonstração</span>
        </div>

        <header className="page-header">
          <div>
            <p className="eyebrow">{heading.eyebrow}</p>
            <h1>{view === "overview" ? `${heading.title}, ${firstName(viewer.name)}.` : heading.title}</h1>
            <p className="page-description">{heading.description}</p>
          </div>
          <div className="header-actions">
            <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Alternar modo claro e escuro"><Icon name="sun" /></button>
            <div className="notification-wrap">
              <button className="icon-button" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-expanded={notificationsOpen} aria-label={`${alerts.length} alertas`}>
                <Icon name="bell" />{alerts.length > 0 && <span className="notification-dot">{alerts.length}</span>}
              </button>
              {notificationsOpen && <NotificationPanel alerts={alerts} onDismiss={(id) => setDismissedAlerts((items) => [...items, id])} />}
            </div>
            <button className="primary-button header-cta" type="button" onClick={() => setModal("account")}><Icon name="plus" /> Adicionar conta</button>
          </div>
        </header>

        {error && <div className="inline-alert" role="alert"><Icon name="info" /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Fechar aviso"><Icon name="close" /></button></div>}

        <div className="page-content">
          {view === "overview" && <Overview data={data} metrics={metrics} alerts={alerts} onNavigate={changeView} onDismissAlert={(id) => setDismissedAlerts((items) => [...items, id])} />}
          {view === "accounts" && <AccountsPage data={data} metrics={metrics} onAdd={() => setModal("account")} onConnect={() => setModal("bank")} onOpenAccount={openAccount} onSync={(id) => manageConnection(id, "sync")} onRenew={(id) => manageConnection(id, "renew")} onDisconnect={disconnectBank} busy={busy} />}
          {view === "transactions" && <TransactionsPage data={data} onCategoryChange={(transactionId, categoryId) => perform({ type: "updateTransactionCategory", transactionId, categoryId }, "Categoria actualizada sem alterar os dados originais.")} onAddTransaction={() => setModal("transaction")} onImport={() => setModal("csvImport")} onAddRule={() => setModal("rule")} onAddCategory={() => setModal("category")} onToggleRule={(ruleId, isActive) => perform({ type: "toggleCategorizationRule", ruleId, isActive }, isActive ? "Regra activada." : "Regra desactivada.")} onDeleteRule={(ruleId) => perform({ type: "deleteCategorizationRule", ruleId }, "Regra eliminada.")} busy={busy} />}
          {view === "budgets" && <BudgetsPage data={data} metrics={metrics} onAdd={() => setModal("budget")} />}
          {view === "planning" && <PlanningPage data={data} onAdd={() => setModal("goal")} />}
          {view === "wealth" && <WealthPage data={data} metrics={metrics} />}
          {view === "reports" && <ReportsPage data={data} metrics={metrics} />}
          {view === "settings" && <SettingsPage data={data} viewer={viewer} busy={busy} onReset={() => perform({ type: "resetDemo" }, "Dados de demonstração repostos.")} />}
        </div>
      </main>

      <MobileNavigation activeView={view} onNavigate={changeView} />
      {modal && <ModalLayer modal={modal} data={data} selectedAccount={selectedAccount} busy={busy} onClose={() => setModal(null)} onSubmit={perform} onConnectBank={connectBank} onToggleAccountVisibility={(accountId, isHidden) => perform({ type: "toggleAccountVisibility", accountId, isHidden }, isHidden ? "Conta ocultada dos totais." : "Conta novamente incluída nos totais.")} />}
      {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="app-shell loading-shell" aria-busy="true" aria-label="A carregar dados financeiros">
      <aside className="sidebar"><Brand /><div className="skeleton skeleton-nav" /><div className="skeleton skeleton-nav" /><div className="skeleton skeleton-nav" /></aside>
      <main className="main-area"><div className="skeleton skeleton-title" /><div className="skeleton-grid"><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-hero" /></div></main>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand-compact" : ""}`}><span className="brand-mark" aria-hidden="true"><span /></span><span className="brand-name">clareza</span></div>;
}

function Sidebar({ activeView, viewer, onNavigate }: { activeView: View; viewer: { name: string; email: string }; onNavigate: (view: View) => void }) {
  return (
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label"><span className="avatar avatar-small">TF</span><span><strong>Finanças da família</strong><small>Espaço partilhado</small></span><Icon name="chevrons" /></div>
      <nav className="side-nav" aria-label="Navegação principal">
        <p className="nav-section-label">Menu</p>
        {NAVIGATION.map((item) => <button key={item.id} type="button" className={activeView === item.id ? "active" : ""} onClick={() => onNavigate(item.id)} aria-current={activeView === item.id ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="privacy-card"><span className="privacy-icon"><Icon name="shield" /></span><div><strong>Os seus dados são seus.</strong><p>Modo read-only e sem venda de dados.</p></div></div>
      <div className="sidebar-user"><span className="avatar">TF</span><span><strong>{viewer.name}</strong><small>{viewer.email}</small></span><span className="status-dot" title="Sessão activa" /></div>
    </aside>
  );
}

function MobileNavigation({ activeView, onNavigate }: { activeView: View; onNavigate: (view: View) => void }) {
  const items = NAVIGATION.slice(0, 4).concat(NAVIGATION.find((item) => item.id === "settings")!);
  return <nav className="mobile-nav" aria-label="Navegação móvel">{items.map((item) => <button type="button" key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}><Icon name={item.icon} /><span>{item.id === "overview" ? "Início" : item.label}</span></button>)}</nav>;
}

type Metrics = ReturnType<typeof calculateMetrics>;

type AlertItem = { id: string; tone: "warning" | "info" | "success"; title: string; detail: string };

function buildAlerts(data: FinanceState, metrics: Metrics): AlertItem[] {
  const budgetWarning = data.budgets.find((budget) => (metrics.spendByCategory[budget.category] ?? 0) / budget.limitCents >= 0.75);
  const expiring = data.connections.find((connection) => connection.status === "connected" && connection.consentExpiresAt);
  return [
    ...(budgetWarning ? [{ id: "budget", tone: "warning" as const, title: `${budgetWarning.category} aproxima-se do limite`, detail: `${Math.round(((metrics.spendByCategory[budgetWarning.category] ?? 0) / budgetWarning.limitCents) * 100)}% do orçamento mensal já foi utilizado.` }] : []),
    ...(expiring ? [{ id: "consent", tone: "info" as const, title: "Consentimento bancário activo", detail: `Renovação prevista até ${formatDate(expiring.consentExpiresAt)}.` }] : []),
    { id: "savings", tone: "success", title: "Poupança mensal positiva", detail: `Está a guardar ${metrics.savingsRate.toFixed(1).replace(".", ",")}% do rendimento contabilizado.` },
  ];
}

function Overview({ data, metrics, alerts, onNavigate, onDismissAlert }: { data: FinanceState; metrics: Metrics; alerts: AlertItem[]; onNavigate: (view: View) => void; onDismissAlert: (id: string) => void }) {
  const topCategories = Object.entries(metrics.spendByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <>
      <section className="overview-top-grid">
        <article className="net-worth-card">
          <div className="card-topline"><span className="card-kicker">Património líquido</span><span className="live-label"><span /> Actualizado às 10:42</span></div>
          <div className="net-worth-value">{formatMoney(metrics.netWorth)}</div>
          <div className="trend-label positive"><Icon name="trendUp" /> +3,8% <span>desde Janeiro</span></div>
          <NetWorthChart />
          <div className="net-worth-split"><div><span>Activos</span><strong>{formatMoney(metrics.assets)}</strong></div><div><span>Passivos</span><strong>{formatMoney(metrics.liabilities)}</strong></div><button type="button" onClick={() => onNavigate("wealth")}>Ver detalhe <Icon name="arrow" /></button></div>
        </article>

        <article className="cash-card surface-card">
          <div className="section-heading compact"><div><p>Dinheiro disponível</p><h2>{formatMoney(metrics.available)}</h2></div><span className="round-icon"><Icon name="wallet" /></span></div>
          <p className="muted-copy">Não inclui {formatMoney(metrics.pending)} em movimentos pendentes.</p>
          <div className="cash-breakdown">
            {data.accounts.filter((account) => ["checking", "savings", "cash"].includes(account.type)).slice(0, 3).map((account) => (
              <div key={account.id}><span className={`account-dot dot-${account.type}`} /><span><strong>{account.name}</strong><small>{account.source === "manual" ? "Manual" : account.institutionName}</small></span><b>{formatMoney(account.availableBalanceCents ?? account.balanceCents)}</b></div>
            ))}
          </div>
          <button className="text-button full" type="button" onClick={() => onNavigate("accounts")}>Ver todas as contas <Icon name="arrow" /></button>
        </article>
      </section>

      <section className="metric-grid" aria-label="Resumo do mês">
        <MetricCard label="Rendimentos" value={formatMoney(metrics.income)} detail="Contabilizados em Julho" tone="positive" icon="trendUp" />
        <MetricCard label="Despesas" value={formatMoney(metrics.expenses)} detail={`${data.transactions.filter((item) => item.amountCents < 0 && item.status === "booked" && !item.isInternalTransfer).length} movimentos`} tone="negative" icon="trendDown" />
        <MetricCard label="Poupança" value={formatMoney(metrics.savings)} detail="Rendimento menos despesas" tone="positive" icon="spark" />
        <MetricCard label="Taxa de poupança" value={`${metrics.savingsRate.toFixed(1).replace(".", ",")}%`} detail="Sobre rendimento líquido" tone="neutral" icon="pie" />
      </section>

      <section className="dashboard-grid">
        <article className="surface-card spending-card">
          <div className="section-heading"><div><p className="section-kicker">Este mês</p><h2>Despesas por categoria</h2></div><button className="text-button" type="button" onClick={() => onNavigate("transactions")}>Ver movimentos <Icon name="arrow" /></button></div>
          <div className="spending-layout">
            <DonutChart items={topCategories} total={metrics.expenses} />
            <div className="category-list">{topCategories.map(([category, amount], index) => <div key={category}><span className={`legend-dot color-${index + 1}`} /><span>{category}</span><strong>{formatMoney(amount)}</strong><small>{Math.round((amount / metrics.expenses) * 100)}%</small></div>)}</div>
          </div>
        </article>

        <article className="surface-card budget-summary-card">
          <div className="section-heading"><div><p className="section-kicker">Orçamentos</p><h2>Execução mensal</h2></div><button className="icon-button small" type="button" onClick={() => onNavigate("budgets")} aria-label="Abrir orçamentos"><Icon name="arrow" /></button></div>
          <div className="budget-list compact-list">{data.budgets.slice(0, 4).map((budget) => <BudgetRow key={budget.id} budget={budget} spent={metrics.spendByCategory[budget.category] ?? 0} />)}</div>
        </article>

        <article className="surface-card goals-summary-card">
          <div className="section-heading"><div><p className="section-kicker">Objectivos</p><h2>A construir futuro</h2></div><button className="icon-button small" type="button" onClick={() => onNavigate("planning")} aria-label="Abrir objectivos"><Icon name="arrow" /></button></div>
          {data.goals.map((goal) => <GoalMini key={goal.id} goal={goal} />)}
        </article>

        <article className="surface-card alerts-card">
          <div className="section-heading"><div><p className="section-kicker">Atenção</p><h2>{alerts.length} sinais relevantes</h2></div><span className="round-icon amber"><Icon name="bell" /></span></div>
          <div className="alerts-list">{alerts.slice(0, 3).map((alert) => <div className={`alert-row ${alert.tone}`} key={alert.id}><span className="alert-symbol"><Icon name={alert.tone === "success" ? "check" : alert.tone === "warning" ? "warning" : "info"} /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><button type="button" onClick={() => onDismissAlert(alert.id)} aria-label={`Dispensar: ${alert.title}`}><Icon name="close" /></button></div>)}</div>
        </article>
      </section>

      <section className="surface-card recent-card">
        <div className="section-heading"><div><p className="section-kicker">Actividade recente</p><h2>Últimos movimentos</h2></div><button className="secondary-button" type="button" onClick={() => onNavigate("transactions")}>Ver todos</button></div>
        <TransactionTable transactions={data.transactions.slice(0, 5)} accounts={data.accounts} compact />
      </section>
    </>
  );
}

function MetricCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: string; icon: IconName }) {
  return <article className="metric-card surface-card"><div className={`metric-icon ${tone}`}><Icon name={icon} /></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function NetWorthChart() {
  return (
    <div className="net-chart">
      <svg viewBox="0 0 520 150" role="img" aria-label="Património líquido de Fevereiro a Julho, crescimento de 10 450 euros para 12 241 euros">
        <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#83d6ae" stopOpacity=".28" /><stop offset="1" stopColor="#83d6ae" stopOpacity="0" /></linearGradient></defs>
        <path className="area" d="M8 122 C72 115 94 106 126 109 S188 84 240 91 S307 65 346 69 S418 42 512 28 L512 145 L8 145Z" fill="url(#chartFill)" />
        <path className="line" d="M8 122 C72 115 94 106 126 109 S188 84 240 91 S307 65 346 69 S418 42 512 28" fill="none" stroke="#91dfb8" strokeWidth="3" strokeLinecap="round" />
        <circle cx="512" cy="28" r="5" fill="#13231f" stroke="#91dfb8" strokeWidth="3" />
      </svg>
      <div className="chart-axis"><span>Fev</span><span>Mar</span><span>Abr</span><span>Mai</span><span>Jun</span><span>Jul</span></div>
      <details><summary>Ver dados em tabela</summary><table><tbody>{[["Fev", "10 450 €"], ["Mar", "10 720 €"], ["Abr", "11 180 €"], ["Mai", "11 540 €"], ["Jun", "11 930 €"], ["Jul", "12 241 €"]].map((row) => <tr key={row[0]}><th>{row[0]}</th><td>{row[1]}</td></tr>)}</tbody></table></details>
    </div>
  );
}

function DonutChart({ items, total }: { items: [string, number][]; total: number }) {
  const colors = ["#1e7f61", "#6bb692", "#d7a84f", "#d8735a", "#7486a6"];
  const boundaries = items.reduce<number[]>((values, [, amount]) => {
    const previous = values.at(-1) ?? 0;
    return [...values, previous + (total ? (amount / total) * 100 : 0)];
  }, []);
  const stops = items.map((_, index) => `${colors[index]} ${boundaries[index - 1] ?? 0}% ${boundaries[index]}%`);
  const cursor = boundaries.at(-1) ?? 0;
  if (cursor < 100) stops.push(`#e9ece8 ${cursor}% 100%`);
  return <div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }} role="img" aria-label={`Despesas contabilizadas: ${formatMoney(total)}`}><div><span>Total</span><strong>{formatMoney(total)}</strong><small>Julho</small></div></div>;
}

function BudgetRow({ budget, spent }: { budget: Budget; spent: number }) {
  const percentage = Math.min(Math.round((spent / budget.limitCents) * 100), 100);
  const tone = percentage >= 90 ? "danger" : percentage >= 75 ? "warning" : "good";
  return <div className="budget-row"><div><span>{budget.category}</span><strong>{formatMoney(spent)} <small>de {formatMoney(budget.limitCents)}</small></strong></div><div className="progress-track" aria-label={`${percentage}% utilizado`}><span className={tone} style={{ width: `${percentage}%` }} /></div><small>{percentage}% utilizado</small></div>;
}

function GoalMini({ goal }: { goal: Goal }) {
  const percentage = Math.min(Math.round((goal.currentCents / goal.targetCents) * 100), 100);
  return <div className="goal-mini"><div className="goal-ring" style={{ background: `conic-gradient(#2a8f6e ${percentage}%, var(--border) ${percentage}% 100%)` }}><span>{percentage}%</span></div><span><strong>{goal.name}</strong><small>{formatMoney(goal.currentCents)} de {formatMoney(goal.targetCents)}</small></span></div>;
}

function AccountsPage({ data, metrics, onAdd, onConnect, onOpenAccount, onSync, onRenew, onDisconnect, busy }: { data: FinanceState; metrics: Metrics; onAdd: () => void; onConnect: () => void; onOpenAccount: (account: Account) => void; onSync: (id: string) => void; onRenew: (id: string) => void; onDisconnect: (id: string) => void; busy: boolean }) {
  const visibleAccounts = data.accounts.filter((account) => !Boolean(account.isHidden));
  return (
    <>
      <section className="subpage-summary surface-card">
        <div><span>Saldo contabilístico total</span><strong>{formatMoney(visibleAccounts.reduce((sum, account) => sum + account.balanceCents, 0))}</strong><small>Em {visibleAccounts.length} contas incluídas · {formatMoney(metrics.pending)} pendentes separados</small></div>
        <div className="summary-divider" /><div><span>Disponível para utilizar</span><strong>{formatMoney(metrics.available)}</strong><small>Última sincronização às 10:42</small></div>
        <div className="summary-actions"><button className="secondary-button" type="button" onClick={onConnect}><Icon name="link" /> Ligar banco</button><button className="primary-button" type="button" onClick={onAdd}><Icon name="plus" /> Conta manual</button></div>
      </section>

      <div className="section-heading page-section-heading"><div><p className="section-kicker">Todas as fontes</p><h2>Contas</h2></div><span className="source-legend"><i className="synced" /> Sincronizada <i className="manual" /> Manual</span></div>
      <section className="accounts-grid">{data.accounts.map((account) => <button className={`account-card surface-card ${account.isHidden ? "hidden-account" : ""}`} type="button" key={account.id} onClick={() => onOpenAccount(account)}><span className={`account-logo ${account.type}`}><Icon name={account.type === "credit" ? "card" : account.type === "savings" ? "spark" : account.type === "cash" ? "cash" : "bank"} /></span><span className="account-source"><i className={account.source} />{account.source === "synced" ? "Sincronizada" : account.source === "manual" ? "Manual" : "Importada"}{account.isHidden && " · Fora dos totais"}</span><span className="account-name">{account.name}<small>{account.institutionName ?? "Introdução manual"}</small></span><strong>{formatMoney(account.balanceCents)}</strong><span className="account-available">Disponível: {formatMoney(account.availableBalanceCents ?? account.balanceCents)}</span><Icon name="arrow" /></button>)}</section>

      <section className="surface-card connections-section">
        <div className="section-heading"><div><p className="section-kicker">Open Banking</p><h2>Ligações bancárias</h2></div><button className="secondary-button" type="button" onClick={onConnect}><Icon name="plus" /> Nova ligação</button></div>
        <div className="connection-list">{data.connections.length ? data.connections.map((connection) => <div className="connection-row" key={connection.id}><span className="institution-logo"><Icon name="bank" /></span><span><strong>{connection.institutionName}</strong><small>Prestador: {connection.provider === "mock" ? "Demonstração local" : "GoCardless Bank Account Data"}</small>{connection.errorMessage && <small className="connection-error">{connection.errorMessage}</small>}</span><span className={`connection-status ${connection.status}`}><i />{connectionStatusLabel(connection.status)}</span><span><small>Última sincronização</small><strong>{formatDate(connection.lastSyncedAt, true)}</strong></span><span className="connection-actions">{connection.status === "connected" && <button className="secondary-text-button" type="button" disabled={busy} onClick={() => onSync(connection.id)}>Sincronizar</button>}{["expired", "requires_action", "error"].includes(connection.status) && <button className="secondary-text-button" type="button" disabled={busy} onClick={() => onRenew(connection.id)}>Renovar</button>}{connection.status !== "revoked" && <button className="danger-text-button" type="button" disabled={busy} onClick={() => { if (window.confirm("Revogar o consentimento e interromper futuras sincronizações?")) onDisconnect(connection.id); }}>Revogar</button>}</span></div>) : <EmptyState icon="bank" title="Sem ligações bancárias" description="Ligue uma instituição no sandbox ou continue com contas manuais e importação CSV." />}</div>
        <div className="sandbox-note"><Icon name="info" /><span><strong>Read-only e sem credenciais bancárias</strong> A autenticação e o consentimento decorrem no prestador ou banco. A Clareza recebe apenas contas, saldos e movimentos autorizados; pagamentos permanecem fora desta versão.</span></div>
      </section>
    </>
  );
}

function TransactionsPage({ data, onCategoryChange, onAddTransaction, onImport, onAddRule, onAddCategory, onToggleRule, onDeleteRule, busy }: { data: FinanceState; onCategoryChange: (id: string, categoryId: string) => void; onAddTransaction: () => void; onImport: () => void; onAddRule: () => void; onAddCategory: () => void; onToggleRule: (id: string, isActive: boolean) => void; onDeleteRule: (id: string) => void; busy: boolean }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todas");
  const [status, setStatus] = useState("Todos");
  const [accountId, setAccountId] = useState("Todas");
  const [sort, setSort] = useState("date-desc");
  const filtered = data.transactions.filter((transaction) => {
    const matchesSearch = `${transaction.description} ${transaction.merchant ?? ""}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (category === "Todas" || transaction.category === category) && (status === "Todos" || transaction.status === status) && (accountId === "Todas" || transaction.accountId === accountId);
  }).sort((left, right) => {
    if (sort === "date-asc") return left.bookedAt.localeCompare(right.bookedAt);
    if (sort === "amount-desc") return Math.abs(right.amountCents) - Math.abs(left.amountCents);
    if (sort === "amount-asc") return Math.abs(left.amountCents) - Math.abs(right.amountCents);
    return right.bookedAt.localeCompare(left.bookedAt);
  });
  return (
    <>
      <section className="surface-card transactions-page-card">
        <div className="transaction-actions"><div><p className="section-kicker">Núcleo financeiro</p><h2>Movimentos</h2></div><button className="secondary-button" type="button" onClick={onImport}><Icon name="upload" /> Importar CSV</button><button className="primary-button" type="button" onClick={onAddTransaction}><Icon name="plus" /> Novo movimento</button></div>
        <div className="transaction-toolbar expanded">
          <label className="search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar comerciante ou descrição" aria-label="Pesquisar movimentos" /></label>
          <label className="select-field"><span>Conta</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option>Todas</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="select-field"><span>Categoria</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Todas</option>{data.categories.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
          <label className="select-field"><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Todos</option><option value="booked">Contabilizados</option><option value="pending">Pendentes</option></select></label>
          <label className="select-field"><span>Ordenação</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="date-desc">Mais recentes</option><option value="date-asc">Mais antigos</option><option value="amount-desc">Maior montante</option><option value="amount-asc">Menor montante</option></select></label>
          <button className="secondary-button" type="button" onClick={() => exportTransactionsCsv(filtered)}><Icon name="download" /> Exportar CSV</button>
        </div>
        <div className="result-summary"><strong>{filtered.length} {filtered.length === 1 ? "movimento" : "movimentos"}</strong><span>Os totais históricos usam apenas movimentos contabilizados.</span></div>
        <TransactionTable transactions={filtered} accounts={data.accounts} categories={data.categories} onCategoryChange={onCategoryChange} busy={busy} />
        {filtered.length === 0 && <EmptyState icon="search" title="Nenhum movimento encontrado" description="Altere os filtros ou a pesquisa para ver outros resultados." />}
      </section>

      <section className="financial-core-grid">
        <article className="surface-card rules-card"><div className="section-heading"><div><p className="section-kicker">Automação explicável</p><h2>Regras de categorização</h2></div><button className="secondary-button" type="button" onClick={onAddRule}><Icon name="plus" /> Nova regra</button></div>{data.rules.length ? <div className="rules-list">{data.rules.map((rule) => <div className="rule-row" key={rule.id}><label className="rule-toggle"><input type="checkbox" checked={rule.isActive} disabled={busy} onChange={(event) => onToggleRule(rule.id, event.target.checked)} /><i /></label><span><strong>{rule.name}</strong><small>{rule.field === "merchant" ? "Comerciante" : "Descrição"} {rule.operator === "contains" ? "contém" : rule.operator === "equals" ? "é igual a" : "começa por"} “{rule.pattern}”</small></span><span className="category-pill">{rule.categoryName}</span><button className="danger-text-button" type="button" disabled={busy} onClick={() => onDeleteRule(rule.id)}>Eliminar</button></div>)}</div> : <EmptyState icon="settings" title="Ainda não existem regras" description="Crie uma regra transparente para classificar movimentos actuais e importações futuras." />}</article>
        <article className="surface-card category-management"><div className="section-heading"><div><p className="section-kicker">Taxonomia</p><h2>Categorias</h2></div><button className="secondary-button" type="button" onClick={onAddCategory}><Icon name="plus" /> Categoria</button></div><div className="category-cloud">{data.categories.map((item) => <span className={`category-pill kind-${item.kind}`} key={item.id}>{item.name}{!item.isSystem && <small>Personalizada</small>}</span>)}</div><div className="import-history"><h3>Importações recentes</h3>{data.imports.length ? data.imports.map((item) => <div key={item.id}><span><strong>{item.fileName}</strong><small>{formatDate(item.createdAt, true)}</small></span><span><b>{item.importedRows}</b> importados · {item.duplicateRows} duplicados · {item.invalidRows} inválidos</span></div>) : <p>Nenhum ficheiro importado.</p>}</div></article>
      </section>
    </>
  );
}

function TransactionTable({ transactions, accounts, categories = [], compact = false, onCategoryChange, busy }: { transactions: Transaction[]; accounts: Account[]; categories?: Category[]; compact?: boolean; onCategoryChange?: (id: string, categoryId: string) => void; busy?: boolean }) {
  return (
    <div className={`table-scroll ${compact ? "compact-table" : ""}`}><table className="transaction-table"><thead><tr><th>Data</th><th>Movimento</th>{!compact && <th>Conta</th>}<th>Categoria</th><th>Estado</th><th className="amount-column">Montante</th></tr></thead><tbody>{transactions.map((transaction) => {
      const account = accounts.find((item) => item.id === transaction.accountId);
      const effectiveCategoryId = transaction.categoryId ?? categories.find((item) => item.name === transaction.category)?.id ?? "";
      return <tr key={transaction.id}><td><span className="date-cell">{new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short" }).format(new Date(`${transaction.bookedAt}T00:00:00`))}</span></td><td><span className={`merchant-icon category-${categorySlug(transaction.category)}`}>{transaction.merchant?.slice(0, 1).toUpperCase() ?? "€"}</span><span className="merchant-copy"><strong>{transaction.merchant ?? transaction.description}</strong><small>{transaction.isInternalTransfer ? "Transferência entre contas próprias" : transaction.description}</small>{!compact && transaction.categorySource && <em>{transaction.categorySource === "user" ? "Corrigida por si" : transaction.categorySource === "rule" ? "Regra ou classificação automática" : "Categoria original"}</em>}</span></td>{!compact && <td><span className="account-cell">{account?.name ?? "Conta removida"}</span></td>}<td>{onCategoryChange && !transaction.isInternalTransfer ? <select className="category-select" value={effectiveCategoryId} disabled={busy} onChange={(event) => onCategoryChange(transaction.id, event.target.value)}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <span className="category-pill">{transaction.category}</span>}</td><td><span className={`status-pill ${transaction.status}`}>{transaction.status === "booked" ? "Contabilizado" : "Pendente"}</span></td><td className={`amount-cell ${transaction.amountCents >= 0 ? "positive" : transaction.isInternalTransfer ? "neutral" : "negative"}`}>{transaction.amountCents >= 0 ? "+" : ""}{formatMoney(transaction.amountCents)}</td></tr>;
    })}</tbody></table></div>
  );
}

function BudgetsPage({ data, metrics, onAdd }: { data: FinanceState; metrics: Metrics; onAdd: () => void }) {
  const totalBudget = data.budgets.reduce((sum, budget) => sum + budget.limitCents, 0);
  const trackedSpend = data.budgets.reduce((sum, budget) => sum + (metrics.spendByCategory[budget.category] ?? 0), 0);
  return (
    <>
      <section className="budget-hero surface-card"><div><p className="section-kicker">Orçamento mensal</p><h2>{formatMoney(totalBudget)}</h2><p>{formatMoney(trackedSpend)} realizado · {formatMoney(Math.max(totalBudget - trackedSpend, 0))} ainda disponível</p></div><div className="budget-total-ring" style={{ background: `conic-gradient(#1f8464 ${Math.min((trackedSpend / totalBudget) * 100, 100)}%, var(--border) 0)` }}><span><strong>{Math.round((trackedSpend / totalBudget) * 100)}%</strong>utilizado</span></div><button className="primary-button" type="button" onClick={onAdd}><Icon name="plus" /> Criar orçamento</button></section>
      <section className="surface-card budget-detail-card"><div className="section-heading"><div><p className="section-kicker">Por categoria</p><h2>Planeado e realizado</h2></div><span className="formula-note"><Icon name="info" /> Transferências internas excluídas</span></div><div className="budget-list large">{data.budgets.map((budget) => <BudgetRow key={budget.id} budget={budget} spent={metrics.spendByCategory[budget.category] ?? 0} />)}</div></section>
      <section className="explanation-card"><span className="round-icon"><Icon name="info" /></span><div><strong>Como calculamos a execução?</strong><p>Somamos movimentos contabilizados de consumo na categoria e dividimos pelo limite mensal. Pendentes e transferências entre contas próprias aparecem separados e não inflam artificialmente a despesa.</p></div></section>
    </>
  );
}

function PlanningPage({ data, onAdd }: { data: FinanceState; onAdd: () => void }) {
  return (
    <>
      <div className="section-heading page-section-heading"><div><p className="section-kicker">Metas activas</p><h2>{data.goals.length} objectivos financeiros</h2></div><button className="primary-button" type="button" onClick={onAdd}><Icon name="plus" /> Novo objectivo</button></div>
      <section className="goals-grid">{data.goals.map((goal) => {
        const percentage = Math.min(Math.round((goal.currentCents / goal.targetCents) * 100), 100);
        const months = goal.targetDate ? Math.max(1, Math.ceil((new Date(goal.targetDate).getTime() - new Date("2026-07-10").getTime()) / 2629800000)) : 12;
        const monthly = Math.max(0, Math.ceil((goal.targetCents - goal.currentCents) / months));
        return <article className="goal-card surface-card" key={goal.id}><div className="goal-card-top"><span className={`goal-icon ${goal.priority}`}><Icon name={goal.name.toLowerCase().includes("emergência") ? "shield" : "sun"} /></span><span className={`priority-pill ${goal.priority}`}>{goal.priority === "high" ? "Prioridade alta" : "Prioridade média"}</span></div><h2>{goal.name}</h2><p><strong>{formatMoney(goal.currentCents)}</strong> de {formatMoney(goal.targetCents)}</p><div className="progress-track large"><span style={{ width: `${percentage}%` }} /></div><div className="goal-meta"><span><small>Progresso</small><strong>{percentage}%</strong></span><span><small>Prazo</small><strong>{formatDate(goal.targetDate)}</strong></span><span><small>Necessário/mês</small><strong>{formatMoney(monthly)}</strong></span></div><div className="scenario-note"><Icon name="spark" /><span>Estimativa base; não é uma garantia de conclusão.</span></div></article>;
      })}</section>
      <section className="surface-card forecast-card"><div className="section-heading"><div><p className="section-kicker">Próximos 30 dias</p><h2>Previsão de tesouraria</h2></div><span className="confidence-pill">Confiança média</span></div><div className="forecast-layout"><div className="forecast-number"><span>Saldo previsto a 09/08</span><strong>{formatMoney(1467200)}</strong><small>Intervalo estimado: {formatMoney(1390000)}–{formatMoney(1515000)}</small></div><div className="forecast-items"><div><span className="positive"><Icon name="trendUp" /></span><span>Rendimentos confirmados<strong>+ {formatMoney(248500)}</strong></span></div><div><span className="negative"><Icon name="trendDown" /></span><span>Recorrências confirmadas<strong>− {formatMoney(117300)}</strong></span></div><div><span className="neutral"><Icon name="info" /></span><span>Orçamentos ainda disponíveis<strong>− {formatMoney(74400)}</strong></span></div></div></div><p className="assumption-line"><strong>Pressupostos:</strong> salário recorrente, despesas fixas confirmadas e utilização integral do orçamento disponível. Valores de demonstração.</p></section>
    </>
  );
}

function WealthPage({ data, metrics }: { data: FinanceState; metrics: Metrics }) {
  const assetAccounts = data.accounts.filter((account) => !Boolean(account.isHidden) && account.balanceCents > 0);
  const debtAccounts = data.accounts.filter((account) => !Boolean(account.isHidden) && account.balanceCents < 0);
  return (
    <>
      <section className="wealth-hero"><article className="surface-card"><span>Património líquido</span><strong>{formatMoney(metrics.netWorth)}</strong><small>Activos menos passivos em 10/07/2026</small></article><article className="surface-card positive-surface"><span>Total de activos</span><strong>{formatMoney(metrics.assets)}</strong><small>{assetAccounts.length} posições incluídas</small></article><article className="surface-card negative-surface"><span>Total de passivos</span><strong>{formatMoney(metrics.liabilities)}</strong><small>{debtAccounts.length} posição de dívida</small></article></section>
      <section className="surface-card wealth-breakdown"><div className="section-heading"><div><p className="section-kicker">Composição</p><h2>Origem do património</h2></div><span className="formula-note"><Icon name="calendar" /> Referência: 10/07/2026</span></div><div className="wealth-columns"><div><h3>Activos</h3>{assetAccounts.map((account) => <div className="wealth-row" key={account.id}><span className={`account-logo small ${account.type}`}><Icon name={account.type === "savings" ? "spark" : "wallet"} /></span><span><strong>{account.name}</strong><small>{account.institutionName ?? "Manual"}</small></span><b>{formatMoney(account.balanceCents)}</b></div>)}</div><div><h3>Passivos</h3>{debtAccounts.length ? debtAccounts.map((account) => <div className="wealth-row" key={account.id}><span className="account-logo small credit"><Icon name="card" /></span><span><strong>{account.name}</strong><small>Saldo em dívida</small></span><b>{formatMoney(Math.abs(account.balanceCents))}</b></div>) : <EmptyState icon="check" title="Sem passivos" description="Não existem dívidas registadas." />}</div></div></section>
      <section className="explanation-card"><span className="round-icon"><Icon name="shield" /></span><div><strong>Fluxo de caixa não é património.</strong><p>Uma amortização de dívida reduz dinheiro disponível, mas também reduz o passivo. Por isso, pode baixar o saldo sem reduzir o património líquido pelo mesmo valor.</p></div></section>
    </>
  );
}

function ReportsPage({ data, metrics }: { data: FinanceState; metrics: Metrics }) {
  return (
    <>
      <section className="report-toolbar surface-card"><div><span>Período do relatório</span><strong>Julho de 2026</strong></div><button className="secondary-button" type="button" onClick={() => exportTransactionsCsv(data.transactions)}><Icon name="download" /> Exportar movimentos</button><button className="primary-button" type="button" onClick={() => window.print()}><Icon name="report" /> Guardar como PDF</button></section>
      <section className="report-sheet surface-card"><div className="report-cover"><Brand compact /><span>Relatório mensal · 01/07/2026–31/07/2026</span></div><h2>Resumo financeiro</h2><div className="report-metrics"><div><span>Rendimentos</span><strong>{formatMoney(metrics.income)}</strong></div><div><span>Despesas</span><strong>{formatMoney(metrics.expenses)}</strong></div><div><span>Poupança</span><strong>{formatMoney(metrics.savings)}</strong></div><div><span>Património</span><strong>{formatMoney(metrics.netWorth)}</strong></div></div><div className="report-insight"><span className="round-icon"><Icon name="spark" /></span><div><strong>Leitura explicável</strong><p>Em Julho, o rendimento contabilizado foi superior às despesas em {formatMoney(metrics.savings)}. Isto corresponde a uma taxa de poupança de {metrics.savingsRate.toFixed(1).replace(".", ",")}%. O cálculo exclui transferências próprias e movimentos pendentes.</p></div></div><h3>Principais categorias de despesa</h3><div className="report-bars">{Object.entries(metrics.spendByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => <div key={category}><span>{category}</span><div><i style={{ width: `${Math.max((amount / metrics.expenses) * 100, 3)}%` }} /></div><strong>{formatMoney(amount)}</strong></div>)}</div><p className="report-footnote">Gerado em modo de demonstração. Este relatório é informativo e não substitui aconselhamento financeiro, fiscal ou contabilístico.</p></section>
    </>
  );
}

function SettingsPage({ data, viewer, busy, onReset }: { data: FinanceState; viewer: { name: string; email: string }; busy: boolean; onReset: () => void }) {
  const [marketing, setMarketing] = useState(false);
  const [alerts, setAlerts] = useState(true);
  return (
    <div className="settings-grid">
      <section className="surface-card settings-card"><div className="settings-heading"><span className="round-icon"><Icon name="user" /></span><div><h2>Perfil e espaço</h2><p>Identidade visível nesta sessão.</p></div></div><dl><div><dt>Nome</dt><dd>{viewer.name}</dd></div><div><dt>Email</dt><dd>{viewer.email}</dd></div><div><dt>Espaço</dt><dd>{data.workspace.name}</dd></div><div><dt>Modo</dt><dd><span className="demo-pill small"><span /> Demonstração</span></dd></div></dl></section>
      <section className="surface-card settings-card"><div className="settings-heading"><span className="round-icon"><Icon name="bell" /></span><div><h2>Notificações</h2><p>Escolha apenas alertas úteis.</p></div></div><label className="toggle-row"><span><strong>Alertas financeiros</strong><small>Orçamentos, saldos e consentimentos.</small></span><input type="checkbox" checked={alerts} onChange={(event) => setAlerts(event.target.checked)} /><i /></label><label className="toggle-row"><span><strong>Comunicações de produto</strong><small>Novidades e melhorias ocasionais.</small></span><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /><i /></label></section>
      <section className="surface-card settings-card wide"><div className="settings-heading"><span className="round-icon"><Icon name="shield" /></span><div><h2>Privacidade e dados</h2><p>Acções críticas permanecem sob o seu controlo.</p></div></div><div className="privacy-actions"><div><span><strong>Exportar os meus dados</strong><small>Descarregue os movimentos desta demonstração em CSV.</small></span><button className="secondary-button" type="button" onClick={() => exportTransactionsCsv(data.transactions)}><Icon name="download" /> Exportar</button></div><div><span><strong>Repor dados de demonstração</strong><small>Remove alterações manuais e volta ao conjunto fictício inicial.</small></span><button className="danger-button" disabled={busy} type="button" onClick={onReset}>{busy ? "A repor…" : "Repor demonstração"}</button></div></div></section>
      <section className="sandbox-note wide"><Icon name="info" /><span><strong>Limite desta versão:</strong> a identidade e o espaço continuam a ser de demonstração. O sandbox do prestador já pode ser configurado, mas MFA, convites familiares, autorização por utilizador, validação regulatória e revisão de segurança são obrigatórios antes de dados reais.</span></section>
    </div>
  );
}

function NotificationPanel({ alerts, onDismiss }: { alerts: AlertItem[]; onDismiss: (id: string) => void }) {
  return <div className="notification-panel"><div><strong>Alertas</strong><span>{alerts.length} por rever</span></div>{alerts.length ? alerts.map((alert) => <article key={alert.id}><span className={`alert-symbol ${alert.tone}`}><Icon name={alert.tone === "success" ? "check" : alert.tone === "warning" ? "warning" : "info"} /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><button type="button" onClick={() => onDismiss(alert.id)} aria-label="Dispensar alerta"><Icon name="close" /></button></article>) : <p className="empty-notifications">Não existem alertas por rever.</p>}</div>;
}

function connectionStatusLabel(status: string) {
  return ({ connected: "Ligada", syncing: "A sincronizar", requires_action: "Requer acção", expired: "Consentimento expirado", revoked: "Revogada", error: "Com erro" } as Record<string, string>)[status] ?? status;
}

function BankConnectionForm({ busy, onClose, onConnect }: { busy: boolean; onClose: () => void; onConnect: (country: string, institutionId: string) => Promise<void> }) {
  const [country, setCountry] = useState("PT");
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<BankProviderMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/banking/institutions?country=${encodeURIComponent(country)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as BankProviderMode & { institutions?: BankInstitution[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as instituições.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const next = payload.institutions ?? [];
        setInstitutions(next);
        setSelected(next[0]?.id ?? "");
        setMode(payload);
      })
      .catch((error: Error) => active && setLoadError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [country]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected) await onConnect(country, selected);
  }

  const banner = mode?.environment === "production"
    ? { title: "Ligação a dados bancários reais", copy: "Será redireccionado para o prestador ou banco para autenticar e autorizar acesso read-only." }
    : mode?.environment === "sandbox"
      ? { title: "Sandbox real do prestador", copy: "O fluxo usa a API sandbox da GoCardless e o banco fictício Sandbox Finance." }
      : { title: "Demonstração local", copy: "O mock não contacta bancos nem solicita credenciais, mas respeita o mesmo contrato técnico." };

  return <form className="modal-form" onSubmit={submit}>
    <div className="sandbox-banner"><Icon name="shield" /><span><strong>{banner.title}</strong>{banner.copy}</span></div>
    <label>País<select value={country} onChange={(event) => { setLoading(true); setLoadError(null); setCountry(event.target.value); }}><option value="PT">Portugal</option><option value="ES">Espanha</option><option value="FR">França</option><option value="DE">Alemanha</option><option value="IE">Irlanda</option></select></label>
    <fieldset className="institution-options"><legend>Instituição</legend>
      {loading && <div className="institution-loading" aria-live="polite"><span className="spinner dark" /> A carregar instituições…</div>}
      {loadError && <div className="inline-form-error" role="alert">{loadError}</div>}
      {!loading && !loadError && institutions.length === 0 && <p className="empty-institutions">Não existem instituições disponíveis para este país no ambiente seleccionado.</p>}
      {institutions.map((institution) => <label key={institution.id}><input type="radio" name="institution" value={institution.id} checked={selected === institution.id} onChange={() => setSelected(institution.id)} /><span className="institution-logo"><Icon name="bank" /></span><span><strong>{institution.name}</strong><small>{mode?.environment === "production" ? "Ligação bancária read-only" : mode?.environment === "sandbox" ? "Sandbox do prestador" : "Dados inteiramente fictícios"}</small></span><Icon name="arrow" /></label>)}
    </fieldset>
    <p className="consent-copy">A Clareza nunca recebe o utilizador, palavra-passe ou código de autenticação do homebanking. Depois do consentimento, inicia uma sincronização idempotente de contas, saldos e movimentos.</p>
    <ModalActions busy={busy} disabled={loading || Boolean(loadError) || !selected} onClose={onClose} submitLabel={mode?.environment === "production" ? "Continuar para o banco" : "Continuar no sandbox"} />
  </form>;
}

function ModalLayer({ modal, data, selectedAccount, busy, onClose, onSubmit, onConnectBank, onToggleAccountVisibility }: { modal: Exclude<Modal, null>; data: FinanceState; selectedAccount: Account | null; busy: boolean; onClose: () => void; onSubmit: (action: ActionPayload, message: string) => Promise<void>; onConnectBank: (country: string, institutionId: string) => Promise<void>; onToggleAccountVisibility: (accountId: string, isHidden: boolean) => Promise<void> }) {
  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const balanceCents = moneyInputToCents(form.get("balance"));
    onSubmit({ type: "createAccount", name: String(form.get("name")), accountType: String(form.get("accountType")), balanceCents }, "Conta manual criada.");
  }
  function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const limitCents = moneyInputToCents(form.get("limit"));
    onSubmit({ type: "createBudget", category: String(form.get("category")), limitCents }, "Orçamento guardado.");
  }
  function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ type: "createGoal", name: String(form.get("name")), targetCents: moneyInputToCents(form.get("target")), currentCents: moneyInputToCents(form.get("current")), targetDate: String(form.get("targetDate")) }, "Objectivo criado.");
  }
  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ type: "createManualTransaction", accountId: String(form.get("accountId")), description: String(form.get("description")), merchant: String(form.get("merchant")), amountCents: moneyInputToCents(form.get("amount")), categoryId: String(form.get("categoryId")), status: String(form.get("status")), bookedAt: String(form.get("bookedAt")), isInternalTransfer: form.get("isInternalTransfer") === "on" }, "Movimento manual criado.");
  }
  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ type: "createCategorizationRule", name: String(form.get("name")), field: String(form.get("field")), operator: String(form.get("operator")), pattern: String(form.get("pattern")), categoryId: String(form.get("categoryId")), priority: Number(form.get("priority")), applyToExisting: form.get("applyToExisting") === "on" }, "Regra criada e aplicada aos movimentos elegíveis.");
  }
  function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onSubmit({ type: "createCategory", name: String(form.get("name")), kind: String(form.get("kind")) }, "Categoria personalizada criada.");
  }

  const accountTransactions = selectedAccount ? data.transactions.filter((transaction) => transaction.accountId === selectedAccount.id) : [];
  const titles: Record<Exclude<Modal, null>, string> = { account: "Adicionar conta manual", bank: "Ligar instituição", budget: "Criar orçamento", goal: "Novo objectivo", accountDetails: selectedAccount?.name ?? "Detalhe da conta", transaction: "Adicionar movimento manual", csvImport: "Importar movimentos CSV", rule: "Nova regra de categorização", category: "Nova categoria" };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><p className="section-kicker">{modal === "bank" ? "Open Banking · Read-only" : "Clareza"}</p><h2 id="modal-title">{titles[modal]}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></div>
    {modal === "account" && <form className="modal-form" onSubmit={submitAccount}><label>Nome da conta<input name="name" required minLength={2} placeholder="Ex.: Conta poupança" /></label><label>Tipo<select name="accountType" defaultValue="checking"><option value="checking">Conta à ordem</option><option value="savings">Conta poupança</option><option value="credit">Cartão de crédito</option><option value="cash">Dinheiro</option><option value="investment">Investimento</option><option value="loan">Empréstimo</option></select></label><label>Saldo contabilístico<div className="money-field"><input name="balance" required inputMode="decimal" placeholder="0,00" /><span>EUR</span></div><small>Use um valor negativo para dívida ou crédito utilizado.</small></label><ModalActions busy={busy} onClose={onClose} submitLabel="Criar conta" /></form>}
    {modal === "budget" && <form className="modal-form" onSubmit={submitBudget}><label>Categoria<select name="category" defaultValue="Supermercado">{data.categories.filter((item) => item.kind === "expense").map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label>Limite mensal<div className="money-field"><input name="limit" required inputMode="decimal" placeholder="300,00" /><span>EUR</span></div></label><div className="form-note"><Icon name="info" /> Se já existir um orçamento para esta categoria em Julho, o limite será actualizado.</div><ModalActions busy={busy} onClose={onClose} submitLabel="Guardar orçamento" /></form>}
    {modal === "goal" && <form className="modal-form" onSubmit={submitGoal}><label>Nome do objectivo<input name="name" required placeholder="Ex.: Entrada para habitação" /></label><div className="form-row"><label>Montante-alvo<div className="money-field"><input name="target" required inputMode="decimal" placeholder="10 000,00" /><span>EUR</span></div></label><label>Já acumulado<div className="money-field"><input name="current" required inputMode="decimal" defaultValue="0,00" /><span>EUR</span></div></label></div><label>Data-alvo<input type="date" name="targetDate" min="2026-07-11" /></label><ModalActions busy={busy} onClose={onClose} submitLabel="Criar objectivo" /></form>}
    {modal === "bank" && <BankConnectionForm busy={busy} onClose={onClose} onConnect={onConnectBank} />}
    {modal === "transaction" && <form className="modal-form" onSubmit={submitTransaction}><label>Conta<select name="accountId">{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><div className="form-row"><label>Data<input name="bookedAt" type="date" required defaultValue="2026-07-10" /></label><label>Estado<select name="status" defaultValue="booked"><option value="booked">Contabilizado</option><option value="pending">Pendente</option></select></label></div><label>Descrição<input name="description" required maxLength={160} placeholder="Ex.: Compra de supermercado" /></label><label>Comerciante<input name="merchant" maxLength={160} placeholder="Opcional" /></label><div className="form-row"><label>Montante<div className="money-field"><input name="amount" required inputMode="decimal" placeholder="-42,50" /><span>EUR</span></div><small>Use um valor negativo para uma saída.</small></label><label>Categoria<select name="categoryId">{data.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label className="checkbox-row"><input name="isInternalTransfer" type="checkbox" /><span><strong>Transferência entre contas próprias</strong><small>Fica excluída das despesas de consumo.</small></span></label><ModalActions busy={busy} onClose={onClose} submitLabel="Criar movimento" /></form>}
    {modal === "rule" && <form className="modal-form" onSubmit={submitRule}><label>Nome da regra<input name="name" required placeholder="Ex.: Compras no Continente" /></label><div className="form-row"><label>Campo<select name="field" defaultValue="merchant"><option value="merchant">Comerciante</option><option value="description">Descrição</option></select></label><label>Condição<select name="operator" defaultValue="contains"><option value="contains">Contém</option><option value="equals">É igual a</option><option value="starts_with">Começa por</option></select></label></div><label>Texto a procurar<input name="pattern" required placeholder="Ex.: CONTINENTE" /></label><div className="form-row"><label>Categoria<select name="categoryId">{data.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Prioridade<input name="priority" type="number" min="0" max="100" defaultValue="50" required /></label></div><label className="checkbox-row"><input name="applyToExisting" type="checkbox" defaultChecked /><span><strong>Aplicar a movimentos existentes</strong><small>As correcções manuais do utilizador nunca são substituídas.</small></span></label><ModalActions busy={busy} onClose={onClose} submitLabel="Criar regra" /></form>}
    {modal === "category" && <form className="modal-form" onSubmit={submitCategory}><label>Nome da categoria<input name="name" required maxLength={80} placeholder="Ex.: Animais de estimação" /></label><label>Tipo<select name="kind" defaultValue="expense"><option value="expense">Despesa</option><option value="income">Rendimento</option><option value="transfer">Transferência</option></select></label><div className="form-note"><Icon name="info" /> A categoria ficará disponível nos movimentos, regras e orçamentos compatíveis.</div><ModalActions busy={busy} onClose={onClose} submitLabel="Criar categoria" /></form>}
    {modal === "csvImport" && <CsvImportForm data={data} busy={busy} onClose={onClose} onSubmit={onSubmit} />}
    {modal === "accountDetails" && selectedAccount && <div className="account-detail"><div className="account-detail-balance"><span>Saldo contabilístico</span><strong>{formatMoney(selectedAccount.balanceCents)}</strong><small>Disponível: {formatMoney(selectedAccount.availableBalanceCents ?? selectedAccount.balanceCents)}</small></div><dl><div><dt>Origem</dt><dd>{selectedAccount.source === "synced" ? "Sincronização bancária" : selectedAccount.source === "imported" ? "Importação" : "Introdução manual"}</dd></div><div><dt>Instituição</dt><dd>{selectedAccount.institutionName ?? "—"}</dd></div><div><dt>Moeda</dt><dd>{selectedAccount.currency}</dd></div><div><dt>Movimentos</dt><dd>{accountTransactions.length}</dd></div></dl><h3>Movimentos desta conta</h3>{accountTransactions.length ? <TransactionTable transactions={accountTransactions.slice(0, 4)} accounts={data.accounts} compact /> : <EmptyState icon="transactions" title="Sem movimentos" description="Esta conta ainda não possui movimentos associados." />}<div className="account-detail-actions"><button className="secondary-button" disabled={busy} type="button" onClick={() => onToggleAccountVisibility(selectedAccount.id, !Boolean(selectedAccount.isHidden))}>{selectedAccount.isHidden ? "Incluir nos totais" : "Ocultar dos totais"}</button><button className="primary-button" type="button" onClick={onClose}>Fechar</button></div></div>}
  </section></div>;
}

function CsvImportForm({ data, busy, onClose, onSubmit }: { data: FinanceState; busy: boolean; onClose: () => void; onSubmit: (action: ActionPayload, message: string) => Promise<void> }) {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({ date: "", description: "", amount: "", merchant: "", category: "", status: "" });
  const [fileError, setFileError] = useState<string | null>(null);

  async function selectFile(file?: File) {
    setFileError(null);
    setParsed(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setFileError("O ficheiro excede o limite de 2 MB desta demonstração.");
      return;
    }
    try {
      const nextContent = await file.text();
      const nextParsed = parseCsvText(nextContent);
      setFileName(file.name);
      setContent(nextContent);
      setParsed(nextParsed);
      setMapping(suggestCsvColumnMapping(nextParsed.headers));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Não foi possível ler o ficheiro CSV.");
    }
  }

  function updateMapping(field: keyof CsvColumnMapping, value: string) {
    setMapping((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed || !fileName) return;
    onSubmit({ type: "importTransactionsCsv", accountId: String(new FormData(event.currentTarget).get("accountId")), fileName, content, delimiter: parsed.delimiter, mapping }, "Importação concluída; duplicados e linhas inválidas foram contabilizados separadamente.");
  }

  const selector = (field: keyof CsvColumnMapping, label: string, required = false) => <label>{label}<select value={mapping[field] ?? ""} required={required} onChange={(event) => updateMapping(field, event.target.value)}><option value="">{required ? "Seleccionar coluna" : "Não importar"}</option>{parsed?.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>;

  return <form className="modal-form csv-import-form" onSubmit={submit}>
    <div className="form-note"><Icon name="info" /> O ficheiro é validado no servidor. Montantes ficam guardados em cêntimos e uma impressão digital impede a importação repetida da mesma linha.</div>
    <label>Conta de destino<select name="accountId">{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
    <label className="file-drop"><input type="file" accept=".csv,text/csv" onChange={(event) => selectFile(event.target.files?.[0])} /><Icon name="upload" /><span><strong>{fileName || "Escolher ficheiro CSV"}</strong><small>Até 2 MB · separadores vírgula, ponto e vírgula ou tabulação</small></span></label>
    {fileError && <div className="inline-form-error" role="alert">{fileError}</div>}
    {parsed && <><div className="csv-summary"><span><strong>{parsed.rows.length}</strong> linhas detectadas</span><span><strong>{parsed.headers.length}</strong> colunas</span><span><strong>{parsed.delimiter === "\t" ? "Tabulação" : parsed.delimiter}</strong> separador</span></div><div className="csv-mapping"><h3>Mapeamento de colunas</h3><div className="form-row">{selector("date", "Data", true)}{selector("amount", "Montante", true)}</div>{selector("description", "Descrição", true)}<div className="form-row">{selector("merchant", "Comerciante")}{selector("category", "Categoria")}</div>{selector("status", "Estado")}</div><div className="csv-preview"><h3>Pré-visualização</h3><div className="table-scroll"><table><thead><tr>{parsed.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 3).map((row, index) => <tr key={index}>{parsed.headers.map((header) => <td key={header}>{row[header] || "—"}</td>)}</tr>)}</tbody></table></div></div></>}
    <ModalActions busy={busy} disabled={!parsed} onClose={onClose} submitLabel="Importar movimentos" />
  </form>;
}

function ModalActions({ busy, disabled = false, onClose, submitLabel }: { busy: boolean; disabled?: boolean; onClose: () => void; submitLabel: string }) {
  return <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy || disabled}>{busy ? <><span className="spinner" /> A guardar…</> : submitLabel}</button></div>;
}

function EmptyState({ icon, title, description }: { icon: IconName; title: string; description: string }) {
  return <div className="empty-state"><span><Icon name={icon} /></span><strong>{title}</strong><p>{description}</p></div>;
}

function exportTransactionsCsv(transactions: Transaction[]) {
  const header = ["Data", "Descrição", "Comerciante", "Categoria", "Estado", "Montante", "Moeda"];
  const rows = transactions.map((transaction) => [transaction.bookedAt, transaction.description, transaction.merchant ?? "", transaction.category, transaction.status, (transaction.amountCents / 100).toFixed(2), transaction.currency]);
  const csv = [header, ...rows].map((row) => row.map((cell) => {
    const value = String(cell);
    const safeValue = /^[=+@]/.test(value) || (/^-/.test(value) && !/^-\d+(?:\.\d+)?$/.test(value)) ? `'${value}` : value;
    return `"${safeValue.replaceAll('"', '""')}"`;
  }).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "clareza-movimentos-julho-2026.csv"; anchor.click(); URL.revokeObjectURL(url);
}

function categorySlug(category: string) {
  return category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

type IconName = "overview" | "wallet" | "transactions" | "budget" | "target" | "wealth" | "report" | "settings" | "sun" | "bell" | "plus" | "arrow" | "shield" | "chevrons" | "trendUp" | "trendDown" | "spark" | "pie" | "warning" | "info" | "close" | "check" | "link" | "bank" | "card" | "cash" | "search" | "download" | "upload" | "calendar" | "user";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    wallet: <><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M16 13h2"/></>,
    transactions: <><path d="m7 7-4 4 4 4"/><path d="M3 11h14a4 4 0 0 1 4 4v1"/><path d="m17 17 4-4-4-4"/><path d="M21 13H7a4 4 0 0 1-4-4V8"/></>,
    budget: <><path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    wealth: <><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></>,
    report: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6M9 9h2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.55V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1.03H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    chevrons: <><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></>, trendUp: <><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></>, trendDown: <><path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/></>,
    spark: <><path d="m12 3-1.4 4.2a5 5 0 0 1-3.2 3.2L3 12l4.4 1.6a5 5 0 0 1 3.2 3.2L12 21l1.4-4.2a5 5 0 0 1 3.2-3.2L21 12l-4.4-1.6a5 5 0 0 1-3.2-3.2Z"/></>,
    pie: <><path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/></>, warning: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>, close: <><path d="M18 6 6 18M6 6l12 12"/></>, check: <><path d="m5 12 4 4L19 6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/></>,
    bank: <><path d="m3 9 9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/></>, card: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></>, cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 10v4M18 10v4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>, upload: <><path d="M12 16V4M7 9l5-5 5 5M5 21h14"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
