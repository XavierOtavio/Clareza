import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCsvTransactions, parseCsvText, suggestCsvColumnMapping } from "../lib/transactions/csv.ts";
import { createTransactionFingerprint } from "../lib/transactions/deduplication.ts";

test("detects Portuguese CSV columns and normalizes money and dates", () => {
  const parsed = parseCsvText('Data;Descrição;Comerciante;Montante;Estado\n10/07/2026;"Compra, semanal";Continente;-87,34;Contabilizado');
  const mapping = suggestCsvColumnMapping(parsed.headers);
  const result = normalizeCsvTransactions(parsed, mapping);

  assert.equal(parsed.delimiter, ";");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.valid[0], {
    bookedAt: "2026-07-10",
    description: "Compra, semanal",
    merchant: "Continente",
    amountCents: -8734,
    category: "Outros",
    status: "booked",
  });
});

test("reports invalid rows without discarding valid rows", () => {
  const parsed = parseCsvText("date,description,amount\n2026-07-10,Coffee,-4.20\n31/02/2026,Invalid,-10.00");
  const result = normalizeCsvTransactions(parsed, suggestCsvColumnMapping(parsed.headers));

  assert.equal(result.valid.length, 1);
  assert.deepEqual(result.errors, [{ row: 3, message: "Data inválida; use DD/MM/AAAA ou AAAA-MM-DD." }]);
});

test("creates stable fingerprints for duplicate imported transactions", async () => {
  const first = await createTransactionFingerprint("account-1", "2026-07-10", -420, "  Fábrica   Coffee ");
  const duplicate = await createTransactionFingerprint("account-1", "2026-07-10", -420, "fabrica coffee");
  const differentAccount = await createTransactionFingerprint("account-2", "2026-07-10", -420, "fabrica coffee");

  assert.equal(first, duplicate);
  assert.notEqual(first, differentAccount);
});
