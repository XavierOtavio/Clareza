import { z } from "zod";
import { renewBankConnection, revokeBankConnection, synchronizeBankConnection } from "@/lib/banking/service";

export const dynamic = "force-dynamic";

const actionSchema = z.object({ action: z.enum(["sync", "renew"]) });

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  try {
    const [{ connectionId }, body] = await Promise.all([context.params, request.json()]);
    const { action } = actionSchema.parse(body);
    if (action === "renew") {
      const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      return Response.json(await renewBankConnection(connectionId, appOrigin), { headers: { "Cache-Control": "no-store" } });
    }
    const key = request.headers.get("Idempotency-Key") ?? `manual:${connectionId}:${crypto.randomUUID()}`;
    return Response.json(await synchronizeBankConnection(connectionId, "manual", key), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível actualizar a ligação." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await context.params;
    await revokeBankConnection(connectionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível revogar a ligação." }, { status: 400 });
  }
}
