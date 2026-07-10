import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getD1() {
  // Keep the native Worker module behind a dynamic boundary so the validated
  // server artifact can be imported by Node without executing a cloud runtime import.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
