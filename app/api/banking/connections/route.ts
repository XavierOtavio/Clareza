import { z } from "zod";
import { startBankConnection } from "@/lib/banking/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  institutionId: z.string().trim().min(1).max(180),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return Response.json(await startBankConnection({ ...input, appOrigin }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a ligação bancária." }, { status: 400 });
  }
}
