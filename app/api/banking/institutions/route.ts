import { z } from "zod";
import { listBankInstitutions } from "@/lib/banking/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const country = z.string().regex(/^[A-Z]{2}$/).parse(new URL(request.url).searchParams.get("country")?.toUpperCase() ?? "PT");
    return Response.json(await listBankInstitutions(country), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível obter as instituições." }, { status: 400 });
  }
}
