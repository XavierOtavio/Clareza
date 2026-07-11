function normalizeFingerprintText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-PT")
    .replace(/\s+/g, " ");
}

export async function createTransactionFingerprint(accountId: string, bookedAt: string, amountCents: number, description: string) {
  const value = `${accountId}|${bookedAt}|${amountCents}|${normalizeFingerprintText(description)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
