import { db } from "@/db";
import { zones } from "@/db/schema";
import { asc } from "drizzle-orm";
import { publish } from "@/lib/server/bus";

export const dynamic = "force-dynamic";

const TYPES = ["OBSERVATION", "SWIMMING", "RESTRICTED", "IGNORE"];

export async function GET() {
  const rows = await db.select().from(zones).orderBy(asc(zones.id));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.name !== "string" || !TYPES.includes(b.type) || !Array.isArray(b.points) || b.points.length < 3) {
    return Response.json({ error: "A zone needs a name, a valid type and at least 3 points" }, { status: 400 });
  }
  const points = b.points
    .map((p: { x: number; y: number }) => ({ x: Math.min(1, Math.max(0, Number(p.x))), y: Math.min(1, Math.max(0, Number(p.y))) }))
    .filter((p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 3) return Response.json({ error: "Invalid points" }, { status: 400 });
  const [row] = await db.insert(zones).values({ name: b.name.slice(0, 60), type: b.type, points, enabled: true }).returning();
  publish("zones.updated", { id: row.id });
  return Response.json(row, { status: 201 });
}
