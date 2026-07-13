import "server-only";
import type { BankDataProvider } from "./provider";
import { MockBankDataProvider } from "./provider";
import { EnableBankingBankDataProvider } from "./enable-banking-provider";

export type BankProviderName = "mock" | "enablebanking";

export function configuredProviderName(): BankProviderName {
  return process.env.BANK_DATA_PROVIDER === "enablebanking" ? "enablebanking" : "mock";
}

export function createBankDataProvider(name: BankProviderName = configuredProviderName()): BankDataProvider {
  if (name === "mock") return new MockBankDataProvider();
  return new EnableBankingBankDataProvider({
    applicationId: process.env.ENABLE_BANKING_APPLICATION_ID ?? "",
    privateKey: process.env.ENABLE_BANKING_PRIVATE_KEY ?? "",
    environment: process.env.BANK_DATA_ENVIRONMENT === "production" ? "production" : "sandbox",
    baseUrl: process.env.ENABLE_BANKING_API_URL,
    accessValidDays: Number(process.env.BANK_DATA_ACCESS_VALID_DAYS ?? 90),
  });
}

export function publicProviderMode() {
  const provider = configuredProviderName();
  return {
    provider,
    environment: provider === "mock" ? "demo" : process.env.BANK_DATA_ENVIRONMENT === "production" ? "production" : "sandbox",
    realBankDataEnabled: provider === "enablebanking",
  } as const;
}
