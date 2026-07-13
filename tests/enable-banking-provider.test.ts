import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { EnableBankingBankDataProvider } from "../lib/banking/enable-banking-provider.ts";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("runs the Enable Banking sandbox authorization, session, pagination, and revocation flow", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const requests: { url: string; init?: RequestInit }[] = [];
  let transactionPage = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const authorization = new Headers(init?.headers).get("Authorization");
    assert.ok(authorization?.startsWith("Bearer "));
    const jwt = (authorization ?? "").slice("Bearer ".length);
    const [header, payload, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { typ: "JWT", alg: "RS256", kid: "application-id" });
    assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).aud, "api.enablebanking.com");
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);

    if (url.includes("/aspsps?")) return json({ aspsps: [{ name: "Mock ASPSP", country: "PT", logo: "https://cdn.example/mock.svg", maximum_consent_validity: 7_776_000 }] });
    if (url.endsWith("/auth") && init?.method === "POST") return json({ authorization_id: "authorization-1", url: "https://mock.enablebanking.test/authorize" });
    if (url.endsWith("/sessions") && init?.method === "POST") return json({ session_id: "session-1", status: "AUTHORIZED", accounts: [{ uid: "account-1" }], aspsp: { name: "Mock ASPSP", country: "PT" }, access: { valid_until: "2026-10-11T00:00:00Z" } });
    if (url.endsWith("/sessions/session-1") && init?.method === "DELETE") return json({ message: "OK" });
    if (url.endsWith("/sessions/session-1")) return json({ session_id: "session-1", status: "AUTHORIZED", accounts: ["account-1"], aspsp: { name: "Mock ASPSP", country: "PT" } });
    if (url.endsWith("/accounts/account-1/details")) return json({ name: "Conta à ordem", cash_account_type: "CACC", currency: "EUR", iban: "PT50000201231234567890154" });
    if (url.endsWith("/accounts/account-1/balances")) return json({ balances: [{ balance_amount: { amount: "1250.40", currency: "EUR" }, balance_type: "CLBD", reference_date: "2026-07-13" }, { balance_amount: { amount: "1210.40", currency: "EUR" }, balance_type: "ITAV", reference_date: "2026-07-13" }] });
    if (url.includes("/accounts/account-1/transactions")) {
      transactionPage += 1;
      if (transactionPage === 1) return json({ transactions: [{ transaction_id: "tx-1", transaction_amount: { amount: "12.34", currency: "EUR" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-07-12", creditor: { name: "Mercado" }, remittance_information: ["Compra semanal"] }], continuation_key: "next-page" });
      return json({ transactions: [{ entry_reference: "pending-1", transaction_amount: { amount: "4.20", currency: "EUR" }, credit_debit_indicator: "DBIT", status: "PDNG", transaction_date: "2026-07-13", creditor: { name: "Café" }, note: "Café" }] });
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  };
  const provider = new EnableBankingBankDataProvider({ applicationId: "application-id", privateKey: privateKeyPem.replace(/\n/g, "\\n"), environment: "sandbox" }, fetcher);

  const institutions = await provider.listInstitutions("PT");
  assert.equal(institutions[0].name, "Mock ASPSP");
  const connection = await provider.createConnection(institutions[0].id, "https://clareza.example/api/banking/callback?connection=1", "callback-state");
  assert.equal(connection.redirectUrl, "https://mock.enablebanking.test/authorize");
  assert.equal(connection.status, "requires_action");

  const authorizationRequest = requests.find((request) => request.url.endsWith("/auth"));
  const authorizationBody = JSON.parse(String(authorizationRequest?.init?.body));
  assert.equal(authorizationBody.state, "callback-state");
  assert.equal(authorizationBody.redirect_url, "https://clareza.example/api/banking/callback?connection=1");
  assert.equal(authorizationBody.access.balances, true);
  assert.equal(authorizationBody.access.transactions, true);

  const callback = await provider.handleCallback(new URLSearchParams({ code: "callback-code", state: "callback-state", providerConnectionId: connection.id }));
  assert.equal(callback.id, "session-1");
  assert.equal(callback.status, "connected");
  assert.equal(callback.consentId, "authorization-1");

  const accounts = await provider.fetchAccounts(callback.id);
  assert.deepEqual(accounts[0], { id: "account-1", name: "Conta à ordem", type: "checking", currency: "EUR", bookedBalanceCents: 125040, availableBalanceCents: 121040, balanceAsOf: "2026-07-13", maskedIdentifier: "•••• 0154" });
  const transactions = await provider.fetchTransactions(callback.id, "2026-07-01");
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amountCents, -1234);
  assert.equal(transactions[0].merchant, "Mercado");
  assert.equal(transactions[1].status, "pending");
  assert.ok(requests.some((request) => request.url.includes("continuation_key=next-page")));
  await provider.revokeConsent(callback.id);
});
