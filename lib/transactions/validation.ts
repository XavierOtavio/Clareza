import { z } from "zod";

const moneyCents = z.number().int().safe();
const nonEmptyText = z.string().trim().min(1).max(160);

export const financeActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createAccount"), name: nonEmptyText, accountType: z.enum(["checking", "savings", "credit", "cash", "investment", "loan"]), balanceCents: moneyCents }),
  z.object({ type: z.literal("toggleAccountVisibility"), accountId: nonEmptyText, isHidden: z.boolean() }),
  z.object({ type: z.literal("createManualTransaction"), accountId: nonEmptyText, description: nonEmptyText, merchant: z.string().trim().max(160).optional(), amountCents: moneyCents, categoryId: nonEmptyText, status: z.enum(["pending", "booked"]), bookedAt: z.iso.date(), isInternalTransfer: z.boolean().default(false) }),
  z.object({ type: z.literal("createBudget"), category: nonEmptyText, limitCents: moneyCents.positive() }),
  z.object({ type: z.literal("createGoal"), name: nonEmptyText, targetCents: moneyCents.positive(), currentCents: moneyCents.nonnegative(), targetDate: z.union([z.iso.date(), z.literal("")]).optional() }),
  z.object({ type: z.literal("updateTransactionCategory"), transactionId: nonEmptyText, categoryId: nonEmptyText }),
  z.object({ type: z.literal("createCategory"), name: nonEmptyText, kind: z.enum(["expense", "income", "transfer"]) }),
  z.object({ type: z.literal("createCategorizationRule"), name: nonEmptyText, field: z.enum(["description", "merchant"]), operator: z.enum(["contains", "equals", "starts_with"]), pattern: nonEmptyText, categoryId: nonEmptyText, priority: z.number().int().min(0).max(100), applyToExisting: z.boolean().default(true) }),
  z.object({ type: z.literal("toggleCategorizationRule"), ruleId: nonEmptyText, isActive: z.boolean() }),
  z.object({ type: z.literal("deleteCategorizationRule"), ruleId: nonEmptyText }),
  z.object({
    type: z.literal("importTransactionsCsv"),
    accountId: nonEmptyText,
    fileName: z.string().trim().min(1).max(255),
    content: z.string().min(1).max(2_000_000),
    delimiter: z.enum([";", ",", "\t"]).optional(),
    mapping: z.object({
      date: nonEmptyText,
      description: nonEmptyText,
      amount: nonEmptyText,
      merchant: z.string().optional(),
      category: z.string().optional(),
      status: z.string().optional(),
    }),
  }),
  z.object({ type: z.literal("connectMockBank"), institutionId: nonEmptyText }),
  z.object({ type: z.literal("disconnectBank"), connectionId: nonEmptyText }),
  z.object({ type: z.literal("resetDemo") }),
]);

export type FinanceAction = z.infer<typeof financeActionSchema>;
