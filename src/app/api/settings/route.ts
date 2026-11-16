import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mergeSettings } from "@/lib/settings";
import { publish } from "@/lib/server/bus";

export const dynamic = "force-dynamic";

async function load() {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "main"));
  return mergeSettings(rows[0]?.value);
}

export async function GET() {
  return Response.json(await load());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });
  const merged = mergeSettings(body);
  await db
    .insert(appSettings)
    .values({ key: "main", value: merged })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: merged } });
  publish("settings.updated", merged);
  return Response.json(merged);
}
