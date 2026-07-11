import { parseMoneyToCents } from "../finance/calculations.ts";

export type CsvColumnMapping = {
  date: string;
  description: string;
  amount: string;
  merchant?: string;
  category?: string;
  status?: string;
};

export type ParsedCsv = {
  delimiter: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type NormalizedCsvTransaction = {
  bookedAt: string;
  description: string;
  merchant: string | null;
  amountCents: number;
  category: string;
  status: "pending" | "booked";
};

const HEADER_ALIASES: Record<keyof CsvColumnMapping, string[]> = {
  date: ["data", "date", "booking date", "booked at", "data movimento", "data valor"],
  description: ["descricao", "description", "movimento", "transaction", "detalhe", "details"],
  amount: ["montante", "amount", "valor", "value", "importe"],
  merchant: ["comerciante", "merchant", "beneficiario", "counterparty", "entidade"],
  category: ["categoria", "category", "tipo"],
  status: ["estado", "status", "situacao"],
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-PT");
}

function parseCsvMatrix(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (quoted) throw new Error("O ficheiro CSV contém aspas sem fecho.");
  return rows;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, columns: parseCsvMatrix(firstLine, delimiter)[0]?.length ?? 0 }))
    .sort((left, right) => right.columns - left.columns)[0]?.delimiter ?? ";";
}

export function parseCsvText(rawText: string, preferredDelimiter?: string): ParsedCsv {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("O ficheiro CSV está vazio.");

  const delimiter = preferredDelimiter || detectDelimiter(text);
  const matrix = parseCsvMatrix(text, delimiter);
  if (matrix.length < 2) throw new Error("O ficheiro CSV deve incluir cabeçalhos e pelo menos uma linha de dados.");

  const headers = matrix[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("Todos os cabeçalhos do CSV devem ter um nome.");
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) throw new Error("O ficheiro CSV contém cabeçalhos duplicados.");

  const rows = matrix.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { delimiter, headers, rows };
}

export function suggestCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const find = (field: keyof CsvColumnMapping) => {
    const aliases = HEADER_ALIASES[field];
    return headers.find((header) => aliases.includes(normalizeHeader(header))) ?? "";
  };

  return {
    date: find("date"),
    description: find("description"),
    amount: find("amount"),
    merchant: find("merchant"),
    category: find("category"),
    status: find("status"),
  };
}

function parseCsvDate(value: string) {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const local = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(trimmed);
  const [, year, month, day] = iso ?? (local ? [local[0], local[3], local[2], local[1]] : []);
  if (!year || !month || !day) return null;

  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? null : `${year}-${month}-${day}`;
}

function parseCsvStatus(value: string): "pending" | "booked" {
  const normalized = normalizeHeader(value);
  return ["pending", "pendente", "authorised", "autorizado"].includes(normalized) ? "pending" : "booked";
}

export function normalizeCsvTransactions(parsed: ParsedCsv, mapping: CsvColumnMapping, defaultCategory = "Outros") {
  for (const required of [mapping.date, mapping.description, mapping.amount]) {
    if (!required || !parsed.headers.includes(required)) throw new Error("Mapeie as colunas obrigatórias: data, descrição e montante.");
  }

  const valid: NormalizedCsvTransaction[] = [];
  const errors: { row: number; message: string }[] = [];

  parsed.rows.forEach((row, index) => {
    const bookedAt = parseCsvDate(row[mapping.date]);
    const description = row[mapping.description]?.trim();
    const amountCents = parseMoneyToCents(row[mapping.amount] ?? "");

    if (!bookedAt) errors.push({ row: index + 2, message: "Data inválida; use DD/MM/AAAA ou AAAA-MM-DD." });
    else if (!description) errors.push({ row: index + 2, message: "Descrição em falta." });
    else if (!Number.isSafeInteger(amountCents)) errors.push({ row: index + 2, message: "Montante inválido." });
    else {
      valid.push({
        bookedAt,
        description,
        merchant: mapping.merchant ? row[mapping.merchant]?.trim() || null : null,
        amountCents,
        category: mapping.category ? row[mapping.category]?.trim() || defaultCategory : defaultCategory,
        status: mapping.status ? parseCsvStatus(row[mapping.status] ?? "") : "booked",
      });
    }
  });

  return { valid, errors };
}
