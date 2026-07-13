import assert from "node:assert/strict";
import test from "node:test";
import { GoCardlessBankDataProvider } from "../lib/banking/gocardless-provider.ts";

function json(value: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("runs the GoCardless sandbox consent and read-only data flow", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/requisitions/requisition-1/") && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/token/new/")) return json({ access: "access-token", access_expires: 86400, refresh: "not-persisted" });
    if (url.endsWith("/agreements/enduser/")) return json({ id: "agreement-1" }, 201);
    if (url.endsWith("/requisitions/") && init?.method === "POST") return json({ id: "requisition-1", status: "CR", link: "https://ob.gocardless.test/authorize" }, 201);
    if (url.endsWith("/requisitions/requisition-1/")) return json({ id: "requisition-1", status: "LN", institution_id: "SANDBOXFINANCE_SFIN0000", accounts: ["account-1"] });
    if (url.endsWith("/accounts/account-1/details/")) return json({ account: { name: "Conta à ordem", cashAccountType: "CACC", currency: "EUR", iban: "PT50000201231234567890154" } });
    if (url.endsWith("/accounts/account-1/balances/")) return json({ balances: [{ balanceAmount: { amount: "1250.40", currency: "EUR" }, balanceType: "closingBooked", referenceDate: "2026-07-13" }, { balanceAmount: { amount: "1210.40", currency: "EUR" }, balanceType: "interimAvailable", referenceDate: "2026-07-13" }] });
    if (url.includes("/accounts/account-1/transactions/")) return json({ transactions: { booked: [{ transactionId: "tx-1", transactionAmount: { amount: "-12.34", currency: "EUR" }, bookingDate: "2026-07-12", creditorName: "Mercado", remittanceInformationUnstructured: "Compra semanal" }], pending: [] } });
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  };
  const provider = new GoCardlessBankDataProvider({ secretId: "secret-id", secretKey: "secret-key", environment: "sandbox" }, fetcher);

  const institutions = await provider.listInstitutions("PT");
  assert.equal(institutions[0].id, "SANDBOXFINANCE_SFIN0000");
  const connection = await provider.createConnection(institutions[0].id, "https://clareza.example/api/banking/callback?connection=1", "callback-state");
  assert.equal(connection.redirectUrl, "https://ob.gocardless.test/authorize");
  const callbackParams = new URLSearchParams({ providerConnectionId: connection.id });
  assert.equal((await provider.handleCallback(callbackParams)).status, "connected");
  const accounts = await provider.fetchAccounts(connection.id);
  assert.deepEqual(accounts[0], { id: "account-1", name: "Conta à ordem", type: "checking", currency: "EUR", bookedBalanceCents: 125040, availableBalanceCents: 121040, balanceAsOf: "2026-07-13", maskedIdentifier: "•••• 0154" });
  const transactions = await provider.fetchTransactions(connection.id, "2026-07-01");
  assert.equal(transactions[0].amountCents, -1234);
  assert.equal(transactions[0].merchant, "Mercado");
  await provider.revokeConsent(connection.id);

  const requisitionRequest = requests.find((request) => request.url.endsWith("/requisitions/") && request.init?.method === "POST");
  assert.match(String(requisitionRequest?.init?.body), /state=callback-state/);
  assert.equal(requests.some((request) => request.url.includes("secret-key")), false);
  assert.equal(requests.filter((request) => request.url.endsWith("/token/new/")).length, 1);
});
