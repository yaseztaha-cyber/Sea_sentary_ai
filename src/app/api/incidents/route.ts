import { db } from "@/db";
import { appSettings, incidentEvents, incidents } from "@/db/schema";
import { desc, eq, inArray, and, gte, isNotNull, sql } from "drizzle-orm";
import { mergeSettings, severityFromLevel, type Observation, type RiskLevel } from "@/lib/settings";
import { publish } from "@/lib/server/bus";
import { dispatchIncident } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";

const OPEN = ["NEW", "ACKNOWLEDGED", "UNDER_REVIEW"];

const listColumns = {
  id: incidents.id,
  ref: incidents.ref,
  severity: incidents.severity,
  status: incidents.status,
  source: incidents.source,
  trackId: incidents.trackId,
  zoneName: incidents.zoneName,
  title: incidents.title,
  isTest: incidents.isTest,
  observationCount: incidents.observationCount,
  ruleVersion: incidents.ruleVersion,
  modelVersion: incidents.modelVersion,
  hasEvidence: sql<boolean>`(${incidents.originalSnapshot} is not null)`,
  createdAt: incidents.createdAt,
  updatedAt: incidents.updatedAt,
  lastObservationAt: incidents.lastObservationAt,
};

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const q = db.select(listColumns).from(incidents);
  const rows = status && status !== "ALL"
    ? await q.where(inArray(incidents.status, status.split(","))).orderBy(desc(incidents.createdAt)).limit(200)
    : await q.orderBy(desc(incidents.createdAt)).limit(200);
  return Response.json(rows);
}

function validObservation(o: unknown): o is Observation {
  if (!o || typeof o !== "object") return false;
  const x = o as Observation;
  return (x.level === 2 || x.level === 3 || x.level === 4) && typeof x.kind === "string" && typeof x.summary === "string";
}

const SEV_RANK: Record<string, number> = { LEVEL_2: 1, WATCH: 1, LEVEL_3: 2, SUSPECTED: 2, CRITICAL: 3 };
const higherSeverity = (a: string, b: string) => ((SEV_RANK[a] ?? 0) >= (SEV_RANK[b] ?? 0) ? a : b);

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || !validObservation(b.observation)) {
    return Response.json({ error: "A valid observation is required" }, { status: 400 });
  }
  const obs: Observation = b.observation;
  const isTest = !!obs.test;
  const riskLevel: RiskLevel = obs.level === 4 ? "CRITICAL" : obs.level === 3 ? "SUSPECTED" : "WATCH";
  const severity = severityFromLevel(obs.level);
  obs.riskLevel = obs.riskLevel ?? riskLevel;
  const trackId: number | null = typeof obs.trackId === "number" ? obs.trackId : null;
  const source: string = typeof b.source === "string" ? b.source.slice(0, 120) : "Unknown camera";
  const modelVersion: string = typeof b.modelVersion === "string" ? b.modelVersion : "unknown";

  const settingsRow = await db.select().from(appSettings).where(eq(appSettings.key, "main"));
  const settings = mergeSettings(settingsRow[0]?.value);
  const since = new Date(Date.now() - settings.evidence.groupWindowSeconds * 1000);

  // Duplicate-event grouping: same open incident for the same track (or same zone) inside the grouping window.
  const open = await db
    .select()
    .from(incidents)
    .where(and(inArray(incidents.status, OPEN), gte(incidents.lastObservationAt, since), eq(incidents.isTest, isTest)))
    .orderBy(desc(incidents.lastObservationAt));
  const dup = open.find((i) => (trackId !== null && i.trackId === trackId) || (obs.zone && i.zoneName === obs.zone && i.source === source));

  if (dup) {
    const list = [...(dup.observations as Observation[]), obs].slice(-50);
    const nextSeverity = higherSeverity(dup.severity, severity);
    const escalated = SEV_RANK[nextSeverity] > SEV_RANK[dup.severity] && nextSeverity === "CRITICAL";
    const [row] = await db
      .update(incidents)
      .set({
        observations: list,
        observationCount: dup.observationCount + 1,
        lastObservationAt: new Date(),
        updatedAt: new Date(),
        severity: nextSeverity,
      })
      .where(eq(incidents.id, dup.id))
      .returning();
    await db.insert(incidentEvents).values({
      incidentId: dup.id,
      type: "OBSERVATION_GROUPED",
      message: `Further observation grouped into this incident: ${obs.summary}`,
    });
    const payload = {
      id: row.id,
      ref: row.ref,
      observationCount: row.observationCount,
      severity: row.severity,
      status: row.status,
      title: row.title,
      trackId: row.trackId,
      zoneName: row.zoneName,
      isTest: row.isTest,
      createdAt: row.createdAt,
      lastObservationAt: row.lastObservationAt,
    };
    publish("incident.grouped", payload);
    if (escalated) {
      await db.insert(incidentEvents).values({ incidentId: dup.id, type: "ESCALATED", message: `Severity escalated to ${row.severity} by a new observation.` });
      await db
        .update(incidents)
        .set({ escalationHistory: [...(dup.escalationHistory as unknown[]), { at: new Date().toISOString(), severity: row.severity, reason: "new observation" }] })
        .where(eq(incidents.id, dup.id));
      publish("incident.escalated", payload);
      void dispatchIncident(dup.id, { origin: new URL(req.url).origin, phase: "ESCALATION" }).catch(() => {});
    }
    return Response.json({ id: row.id, ref: row.ref, grouped: true, severity: row.severity });
  }

  const tmpRef = `TMP-${Math.random().toString(36).slice(2, 10)}`;
  const [created] = await db
    .insert(incidents)
    .values({
      ref: tmpRef,
      severity,
      status: "NEW",
      source,
      trackId,
      zoneName: obs.zone ?? null,
      title: isTest ? `TEST observation — controlled (${riskLevel})` : obs.kind,
      isTest,
      observations: [obs],
      ruleVersion: obs.ruleVersion,
      modelVersion,
      trackHistory: Array.isArray(b.trackHistory) ? b.trackHistory.slice(-300) : [],
      preEventSnapshot: typeof b.preEventSnapshot === "string" ? b.preEventSnapshot : null,
      originalSnapshot: typeof b.originalSnapshot === "string" ? b.originalSnapshot : null,
      annotatedSnapshot: typeof b.annotatedSnapshot === "string" ? b.annotatedSnapshot : null,
      escalationHistory: [{ at: new Date().toISOString(), severity, reason: "initial observation" }],
    })
    .returning();
  const ref = `INC-${String(created.id).padStart(4, "0")}`;
  await db.update(incidents).set({ ref }).where(eq(incidents.id, created.id));
  await db.insert(incidentEvents).values({
    incidentId: created.id,
    type: "CREATED",
    message: `Incident created from observation: ${obs.summary}`,
  });

  // Bounded retention: drop evidence blobs from older incidents beyond the configured limit.
  const keep = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(isNotNull(incidents.originalSnapshot))
    .orderBy(desc(incidents.createdAt))
    .limit(settings.evidence.maxIncidentsWithEvidence);
  const keepIds = keep.map((k) => k.id);
  if (keepIds.length >= settings.evidence.maxIncidentsWithEvidence) {
    await db
      .update(incidents)
      .set({ originalSnapshot: null, annotatedSnapshot: null, preEventSnapshot: null })
      .where(sql`${incidents.id} not in (${sql.join(keepIds.map((i) => sql`${i}`), sql`, `)}) and ${incidents.originalSnapshot} is not null`);
  }

  publish("incident.created", {
    id: created.id,
    ref,
    severity: created.severity,
    riskLevel,
    status: created.status,
    isTest,
    title: created.title,
    trackId,
    zoneName: created.zoneName,
    source,
    createdAt: created.createdAt,
  });
  if (!isTest && severity === "CRITICAL") {
    // Independent server-side channels. Failure in one channel cannot prevent
    // the local console alert (driven by SSE) or the other channels.
    void dispatchIncident(created.id, { origin: new URL(req.url).origin }).catch(() => {});
  }
  return Response.json({ id: created.id, ref, grouped: false, severity: created.severity }, { status: 201 });
}
