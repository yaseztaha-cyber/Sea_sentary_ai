import { db } from "@/db";
import { incidentEvents, incidents } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { publish } from "@/lib/server/bus";
import { acknowledgeDeliveries, listDeliveries } from "@/lib/server/notifications/deliveries";
import { stopPhoneEscalation } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db
    .select({
      id: incidents.id,
      ref: incidents.ref,
      severity: incidents.severity,
      status: incidents.status,
      source: incidents.source,
      trackId: incidents.trackId,
      zoneName: incidents.zoneName,
      title: incidents.title,
      isTest: incidents.isTest,
      observations: incidents.observations,
      observationCount: incidents.observationCount,
      ruleVersion: incidents.ruleVersion,
      modelVersion: incidents.modelVersion,
      trackHistory: incidents.trackHistory,
      hasOriginal: sql<boolean>`(${incidents.originalSnapshot} is not null)`,
      hasAnnotated: sql<boolean>`(${incidents.annotatedSnapshot} is not null)`,
      hasPre: sql<boolean>`(${incidents.preEventSnapshot} is not null)`,
      escalationHistory: incidents.escalationHistory,
      acknowledgedAt: incidents.acknowledgedAt,
      lastObservationAt: incidents.lastObservationAt,
      createdAt: incidents.createdAt,
      updatedAt: incidents.updatedAt,
    })
    .from(incidents)
    .where(eq(incidents.id, Number(id)));
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const events = await db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, row.id)).orderBy(asc(incidentEvents.createdAt), asc(incidentEvents.id));
  const deliveries = await listDeliveries(row.id);
  return Response.json({ ...row, events, deliveries });
}

const ACTIONS: Record<string, { status?: string; type: string; msg: string }> = {
  acknowledge: { status: "ACKNOWLEDGED", type: "ACKNOWLEDGED", msg: "Incident acknowledged by operator" },
  review: { status: "UNDER_REVIEW", type: "UNDER_REVIEW", msg: "Incident moved under review" },
  resolve: { status: "RESOLVED", type: "RESOLVED", msg: "Incident resolved by operator" },
  false_alarm: { status: "FALSE_ALARM", type: "FALSE_ALARM", msg: "Marked as false alarm by operator" },
  note: { type: "NOTE", msg: "" },
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const spec = b && ACTIONS[b.action];
  if (!spec) return Response.json({ error: "Unknown action" }, { status: 400 });
  const [inc] = await db.select({ id: incidents.id, ref: incidents.ref, status: incidents.status }).from(incidents).where(eq(incidents.id, Number(id)));
  if (!inc) return Response.json({ error: "Not found" }, { status: 404 });

  let message = spec.msg;
  if (b.action === "note") {
    const note = typeof b.note === "string" ? b.note.trim() : "";
    if (!note) return Response.json({ error: "Note text is required" }, { status: 400 });
    message = note.slice(0, 1000);
  } else if (typeof b.note === "string" && b.note.trim()) {
    message += ` — ${b.note.trim().slice(0, 500)}`;
  }
  if (spec.status) {
    await db
      .update(incidents)
      .set({ status: spec.status, updatedAt: new Date(), ...(b.action === "acknowledge" ? { acknowledgedAt: new Date() } : {}) })
      .where(eq(incidents.id, inc.id));
  } else {
    await db.update(incidents).set({ updatedAt: new Date() }).where(eq(incidents.id, inc.id));
  }
  if (b.action === "acknowledge") {
    await acknowledgeDeliveries(inc.id);
    await stopPhoneEscalation(inc.id).catch(() => {});
  }
  if (b.action === "resolve" || b.action === "false_alarm") {
    await stopPhoneEscalation(inc.id).catch(() => {});
  }
  await db.insert(incidentEvents).values({ incidentId: inc.id, type: spec.type, message });
  const evtName = b.action === "acknowledge" ? "incident.acknowledged" : b.action === "resolve" || b.action === "false_alarm" ? "incident.resolved" : "incident.updated";
  publish(evtName, { id: inc.id, ref: inc.ref, status: spec.status ?? inc.status, action: b.action });
  return Response.json({ ok: true });
}
