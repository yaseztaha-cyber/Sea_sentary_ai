import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const r = await db.execute<{ table: string | null }>(sql`select to_regclass('public.incidents')::text as "table"`);
    const rows = (r as unknown as { rows?: { table: string | null }[] }).rows ?? [];
    const schemaReady = !!rows[0]?.table;
    return Response.json(
      { ok: schemaReady, database: "up", schema: schemaReady ? "ready" : "missing", uptimeSeconds: Math.round(process.uptime()), at: new Date().toISOString() },
      { status: schemaReady ? 200 : 503 },
    );
  } catch {
    return Response.json({ ok: false, database: "unavailable", schema: "unknown", at: new Date().toISOString() }, { status: 503 });
  }
}
