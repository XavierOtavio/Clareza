import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingCategorizationRule, matchesCategorizationRule, type CategorizationRule } from "../lib/transactions/rules.ts";

const baseRule: CategorizationRule = {
  id: "rule-1",
  name: "Supermarket",
  field: "merchant",
  operator: "contains",
  pattern: "CONTINENTE",
  categoryId: "category-grocery",
  categoryName: "Supermercado",
  priority: 50,
  isActive: true,
};

test("matches rules case-insensitively and without diacritics", () => {
  assert.equal(matchesCategorizationRule({ description: "Compra", merchant: "Continente Modélo" }, { ...baseRule, pattern: "continente modelo" }), true);
  assert.equal(matchesCategorizationRule({ description: "Compra", merchant: "Continente" }, { ...baseRule, isActive: false }), false);
});

test("uses the highest-priority matching rule deterministically", () => {
  const result = findMatchingCategorizationRule({ description: "Continente online", merchant: "Continente" }, [
    baseRule,
    { ...baseRule, id: "rule-2", name: "Online order", field: "description", priority: 80, categoryId: "category-other", categoryName: "Outros" },
  ]);

  assert.equal(result?.id, "rule-2");
});
