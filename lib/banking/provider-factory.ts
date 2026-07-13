import "server-only";
import type { BankDataProvider } from "./provider";
import { MockBankDataProvider } from "./provider";
import { GoCardlessBankDataProvider } from "./gocardless-provider";

export type BankProviderName = "mock" | "gocardless";

export function configuredProviderName(): BankProviderName {
  return process.env.BANK_DATA_PROVIDER === "gocardless" ? "gocardless" : "mock";
}

export function createBankDataProvider(name: BankProviderName = configuredProviderName()): BankDataProvider {
  if (name === "mock") return new MockBankDataProvider();
  return new GoCardlessBankDataProvider({
    secretId: process.env.GOCARDLESS_BANK_ACCOUNT_DATA_SECRET_ID ?? "",
    secretKey: process.env.GOCARDLESS_BANK_ACCOUNT_DATA_SECRET_KEY ?? "",
    environment: process.env.BANK_DATA_ENVIRONMENT === "production" ? "production" : "sandbox",
    accessValidDays: Number(process.env.BANK_DATA_ACCESS_VALID_DAYS ?? 90),
    historicalDays: Number(process.env.BANK_DATA_HISTORY_DAYS ?? 90),
  });
}

export function publicProviderMode() {
  const provider = configuredProviderName();
  return {
    provider,
    environment: provider === "mock" ? "demo" : process.env.BANK_DATA_ENVIRONMENT === "production" ? "production" : "sandbox",
    realBankDataEnabled: provider === "gocardless",
  } as const;
}
