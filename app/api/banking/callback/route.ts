import { completeBankCallback } from "@/lib/banking/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const destination = new URL("/", appOrigin);
  try {
    const connectionId = url.searchParams.get("connection");
    if (!connectionId) throw new Error("A ligação bancária não foi identificada.");
    await completeBankCallback({ connectionId, state: url.searchParams.get("state"), params: url.searchParams });
    destination.searchParams.set("bank", "connected");
  } catch {
    destination.searchParams.set("bank", "error");
    destination.searchParams.set("reason", "Não foi possível concluir o consentimento. Confirme a ligação ou inicie uma renovação.");
  }
  return Response.redirect(destination, 303);
}
