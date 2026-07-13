const CURRENCY_DIGITS: Record<string, number> = { BHD: 3, JPY: 0, KWD: 3, OMR: 3, TND: 3 };

export function decimalAmountToMinorUnits(value: string, currency: string): number {
  const digits = CURRENCY_DIGITS[currency.toUpperCase()] ?? 2;
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid monetary amount: ${value}`);
  const [, sign, units, fraction = ""] = match;
  const padded = `${fraction}${"0".repeat(digits + 1)}`;
  const kept = padded.slice(0, digits);
  const roundDigit = Number(padded[digits] ?? "0");
  let minor = BigInt(units) * BigInt(10) ** BigInt(digits) + BigInt(kept || "0");
  if (roundDigit >= 5) minor += BigInt(1);
  if (sign === "-") minor *= BigInt(-1);
  const number = Number(minor);
  if (!Number.isSafeInteger(number)) throw new Error("Monetary amount exceeds the supported safe integer range.");
  return number;
}
