import { db } from "@/db";
import { zones } from "@/db/schema";
import { eq } from "drizzle-orm";
import { publish } from "@/lib/server/bus";

export const dynamic = "force-dynamic";

const TYPES = ["OBSERVATION", "SWIMMING", "RESTRICTED", "IGNORE"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  if (!b) return Response.json({ error: "Invalid body" }, { status: 400 });
  const set: Partial<typeof zones.$inferInsert> = {};
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.slice(0, 60);
  if (typeof b.enabled === "boolean") set.enabled = b.enabled;
  if (TYPES.includes(b.type)) set.type = b.type;
  if (Array.isArray(b.points) && b.points.length >= 3) set.points = b.points;
  if (Object.keys(set).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });
  const [row] = await db.update(zones).set(set).where(eq(zones.id, Number(id))).returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  publish("zones.updated", { id: row.id });
  return Response.json(row);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.delete(zones).where(eq(zones.id, Number(id)));
  publish("zones.updated", { id: Number(id), deleted: true });
  return Response.json({ ok: true });
}
