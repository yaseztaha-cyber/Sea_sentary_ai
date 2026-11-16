import { db } from "@/db";
import { incidents } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "original";
  const [row] = await db
    .select({ o: incidents.originalSnapshot, a: incidents.annotatedSnapshot, p: incidents.preEventSnapshot })
    .from(incidents)
    .where(eq(incidents.id, Number(id)));
  const data = kind === "annotated" ? row?.a : kind === "pre" ? row?.p : row?.o;
  const m = data?.match(/^data:(image\/jpeg|image\/png);base64,(.+)$/);
  if (!m) return new Response("Evidence not available (never stored or removed by retention)", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=3600" } });
}
