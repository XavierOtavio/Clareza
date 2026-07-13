import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createCallbackState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCallbackState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function callbackStateMatches(state: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashCallbackState(state), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildCallbackUrl(appOrigin: string, connectionId: string): string {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
    throw new Error("The Open Banking callback origin must use HTTPS outside localhost.");
  }
  const callback = new URL("/api/banking/callback", origin);
  callback.searchParams.set("connection", connectionId);
  return callback.toString();
}

export function callbackStateIsUsable(input: {
  state: string | null;
  expectedHash: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  now?: Date;
}): boolean {
  if (!input.state || !input.expectedHash || input.usedAt) return false;
  if (!input.expiresAt || new Date(input.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) return false;
  return callbackStateMatches(input.state, input.expectedHash);
}
