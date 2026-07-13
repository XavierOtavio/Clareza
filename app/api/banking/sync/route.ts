import { synchronizeDueConnections } from "@/lib/banking/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const results = await synchronizeDueConnections();
    return Response.json({ synchronized: results.length, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Scheduled synchronization failed." }, { status: 500 });
  }
}
