export type RuleField = "description" | "merchant";
export type RuleOperator = "contains" | "equals" | "starts_with";

export type CategorizationRule = {
  id: string;
  name: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  categoryId: string;
  categoryName: string;
  priority: number;
  isActive: boolean;
};

export type RuleCandidate = {
  description: string;
  merchant?: string | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-PT");
}

export function matchesCategorizationRule(candidate: RuleCandidate, rule: CategorizationRule) {
  if (!rule.isActive) return false;

  const source = normalize(rule.field === "merchant" ? candidate.merchant ?? "" : candidate.description);
  const pattern = normalize(rule.pattern);
  if (!source || !pattern) return false;

  if (rule.operator === "equals") return source === pattern;
  if (rule.operator === "starts_with") return source.startsWith(pattern);
  return source.includes(pattern);
}

export function findMatchingCategorizationRule(candidate: RuleCandidate, rules: CategorizationRule[]) {
  return [...rules]
    .filter((rule) => matchesCategorizationRule(candidate, rule))
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name, "pt-PT"))[0] ?? null;
}
