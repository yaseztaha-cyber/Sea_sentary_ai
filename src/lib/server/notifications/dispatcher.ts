import { db } from "@/db";
import { alertDeliveries, appSettings, incidentEvents, incidents } from "@/db/schema";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { mergeSettings, type Settings } from "@/lib/settings";
import { recordDelivery, listDeliveries, redactPhone, updatePhoneDelivery } from "./deliveries";
import { sendWebPushAlert } from "./webPush";
import { sendTelegramAlert, telegramConfigured } from "./telegram";
import { activePhoneProvider, phoneConfigStatus, statusToState, validateResponders } from "./phone";
import type { ChannelResult, DeliveryChannel, DeliveryStatus, IncidentAlert } from "./types";

const OPEN_STATUS = ["NEW", "UNDER_REVIEW", "ACKNOWLEDGED"];

export async function loadServerSettings(): Promise<Settings> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, "main"));
  return mergeSettings(rows[0]?.value);
}

function baseUrl(origin?: string) {
  return (process.env.PUBLIC_BASE_URL ?? origin ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function buildIncidentAlert(incidentId: number, origin?: string): Promise<IncidentAlert | null> {
  const [row] = await db.select().from(incidents).where(eq(incidents.id, incidentId));
  if (!row) return null;
  const base = baseUrl(origin);
  return {
    incidentId: row.id,
    ref: row.ref,
    severity: row.severity,
    status: row.status,
    title: row.title,
    camera: row.source,
    zone: row.zoneName,
    trackId: row.trackId,
    isTest: row.isTest,
    createdAt: row.createdAt.toISOString(),
    incidentUrl: `${base}/app/incidents?id=${row.id}`,
    evidenceDataUrl: row.isTest ? null : row.originalSnapshot,
    evidenceAvailable: !row.isTest && !!row.originalSnapshot,
  };
}

/**
 * Central dispatcher for server-side channels. Local siren/voice are driven by
 * the operator console and report back separately; a failure in one channel
 * never blocks another channel. The dispatcher is deliberately idempotent.
 */
export async function dispatchIncident(incidentId: number, opts: { origin?: string; phase?: string } = {}) {
  const alert = await buildIncidentAlert(incidentId, opts.origin);
  if (!alert) return [] as ChannelResult[];
  if (alert.isTest) {
    // Controlled TEST incidents exercise the operator UI and can be sent via
    // the explicit test center; they never trigger responder calls.
    return [] as ChannelResult[];
  }
  if (alert.severity !== "CRITICAL") return [] as ChannelResult[];
  const settings = await loadServerSettings();
  const phase = opts.phase ?? "CREATED";
  const results: ChannelResult[] = [];

  const tasks: Promise<void>[] = [];

  tasks.push(
    (async () => {
      if (!settings.notifications.webPush.enabled) {
        await recordDelivery({ incidentId, channel: "WEB_PUSH", phase, status: "DISABLED", error: "Web Push is disabled in Settings" });
        return;
      }
      const rows = await sendWebPushAlert(alert);
      for (const r of rows) {
        await recordDelivery({
          incidentId,
          channel: "WEB_PUSH",
          recipient: r.recipient,
          phase,
          status: r.status,
          providerId: r.providerId,
          providerStatus: r.providerStatus,
          error: r.error,
          payload: { ref: alert.ref, zone: alert.zone, camera: alert.camera, endpointHost: r.detail?.endpointHost ?? null },
        });
        results.push(r);
      }
    })().catch(async (e) => {
      results.push({ channel: "WEB_PUSH", status: "FAILED", recipient: "all", providerId: null, providerStatus: "ERROR", error: (e as Error).message });
      await recordDelivery({ incidentId, channel: "WEB_PUSH", phase, status: "FAILED", error: (e as Error).message }).catch(() => {});
    }),
  );

  tasks.push(
    (async () => {
      if (!settings.notifications.telegram.enabled) {
        await recordDelivery({ incidentId, channel: "TELEGRAM", phase, status: "DISABLED", error: "Telegram is disabled in Settings" });
        return;
      }
      if (!telegramConfigured()) {
        await recordDelivery({ incidentId, channel: "TELEGRAM", phase, status: "NOT_CONFIGURED", error: "TELEGRAM_BOT_TOKEN is not set on the server" });
        return;
      }
      const rows = await sendTelegramAlert(alert, settings);
      for (const r of rows) {
        await recordDelivery({
          incidentId,
          channel: "TELEGRAM",
          recipient: r.recipient,
          phase,
          status: r.status,
          providerId: r.providerId,
          providerStatus: r.providerStatus,
          error: r.error,
          payload: { ref: alert.ref, messageId: r.providerId, photo: r.detail?.photo ?? null, audio: r.detail?.audio ?? null },
        });
        results.push(r);
      }
    })().catch(async (e) => {
      results.push({ channel: "TELEGRAM", status: "FAILED", recipient: "telegram", providerId: null, providerStatus: "ERROR", error: (e as Error).message });
      await recordDelivery({ incidentId, channel: "TELEGRAM", phase, status: "FAILED", error: (e as Error).message }).catch(() => {});
    }),
  );

  tasks.push(
    (async () => {
      if (!settings.notifications.phone.enabled || !settings.notifications.phone.autoCall) {
        const status: DeliveryStatus = settings.notifications.phone.enabled ? "DISABLED" : "NOT_CONFIGURED";
        await recordDelivery({
          incidentId,
          channel: "PHONE_CALL",
          phase,
          status,
          error: settings.notifications.phone.enabled ? "Automatic calling is off" : "Phone call not configured",
        });
        return;
      }
      if (!phoneConfigStatus().configured) {
        await recordDelivery({ incidentId, channel: "PHONE_CALL", phase, status: "NOT_CONFIGURED", error: "PHONE CALL NOT CONFIGURED" });
        return;
      }
      const first = validateResponders(settings.notifications.phone.responders).valid[0];
      if (!first) {
        await recordDelivery({ incidentId, channel: "PHONE_CALL", phase, status: "NOT_CONFIGURED", error: "No valid responder number is configured" });
        return;
      }
      await recordDelivery({
        incidentId,
        channel: "PHONE_CALL",
        recipient: first,
        phase,
        status: "PENDING",
        payload: { ref: alert.ref, scheduledAfterSeconds: settings.notifications.phone.escalationSeconds },
      });
      results.push({ channel: "PHONE_CALL", status: "PENDING", recipient: redactPhone(first), providerId: null, providerStatus: "SCHEDULED", error: null });
    })().catch(async (e) => {
      results.push({ channel: "PHONE_CALL", status: "FAILED", recipient: "responder", providerId: null, providerStatus: "ERROR", error: (e as Error).message });
    }),
  );

  await Promise.allSettled(tasks);
  ensureEscalationWorker();
  return results;
}

/* ------------ automatic call escalation worker ------------ */

type Globals = typeof globalThis & { __sentryEscalationWorker?: ReturnType<typeof setInterval>; __sentryEscalationBusy?: boolean };
const g = globalThis as Globals;

export function ensureEscalationWorker() {
  if (g.__sentryEscalationWorker) return;
  g.__sentryEscalationWorker = setInterval(() => void escalationTick().catch(() => {}), 10_000);
  // Do not keep a CLI/test process alive solely for the worker.
  (g.__sentryEscalationWorker as { unref?: () => void }).unref?.();
}

export async function escalationTick(now = new Date()) {
  if (g.__sentryEscalationBusy) return;
  g.__sentryEscalationBusy = true;
  try {
    const settings = await loadServerSettings();
    const phone = settings.notifications.phone;
    if (!phone.enabled || !phone.autoCall) return;
    const provider = activePhoneProvider();
    if (!provider) return;
    const { valid } = validateResponders(phone.responders);
    if (!valid.length) return;
    const due = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.severity, "CRITICAL"), eq(incidents.isTest, false), inArray(incidents.status, OPEN_STATUS), lte(incidents.createdAt, new Date(now.getTime() - phone.escalationSeconds * 1000))));
    for (const inc of due) {
      // Acknowledgement stops escalation. A critical incident remains open
      // until resolved, but no more calls are placed after acknowledgment.
      if (inc.status === "ACKNOWLEDGED") continue;
      const rows = (await listDeliveries(inc.id)).filter((r) => r.channel === "PHONE_CALL" && (r.phase === "CREATED" || r.phase === "ESCALATION"));
      const attempts = rows.filter((r) => r.providerId || r.status === "FAILED" || r.status === "SENT" || r.status === "DELIVERED").length;
      if (attempts >= phone.maxAttempts) continue;
      const inFlight = rows.find((r) => r.providerId && ["SENT", "PENDING"].includes(r.status) && ["queued", "initiated", "ringing", "in-progress", "answered"].includes((r.providerStatus ?? "").toLowerCase()));
      if (inFlight) continue;
      const last = rows[rows.length - 1];
      if (last?.status === "FAILED" && now.getTime() - new Date(last.updatedAt).getTime() < phone.retrySeconds * 1000) continue;
      const to = valid[Math.min(attempts, valid.length - 1)];
      if (!to) continue;
      const callbackSecret = process.env.TWILIO_STATUS_SECRET?.trim();
      const publicBase = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
      if (!publicBase) continue;
      const twimlUrl = `${publicBase}/api/phone/twiml?incident=${inc.id}`;
      const statusCallbackUrl = `${publicBase}/api/phone/webhook?incident=${inc.id}&recipient=${encodeURIComponent(to)}${callbackSecret ? `&token=${encodeURIComponent(callbackSecret)}` : ""}`;
      const result = await provider.placeCall({
        to,
        incidentId: inc.id,
        incidentRef: inc.ref,
        idempotencyKey: `incident:${inc.id}:recipient:${to}`,
        twimlUrl,
        statusCallbackUrl,
      });
      const status: DeliveryStatus = result.ok ? "SENT" : "FAILED";
      await recordDelivery({
        incidentId: inc.id,
        channel: "PHONE_CALL",
        recipient: to,
        phase: rows.length ? (rows[0].phase as string) : "ESCALATION",
        status,
        providerId: result.providerId,
        providerStatus: result.providerStatus,
        error: result.error,
        payload: { attempt: attempts + 1, recipient: redactPhone(to), state: result.state },
      });
      await db.insert(incidentEvents).values({
        incidentId: inc.id,
        type: "PHONE_ATTEMPT",
        message: `Phone escalation attempt ${attempts + 1}/${phone.maxAttempts} to ${redactPhone(to)}: ${result.providerStatus ?? result.state}${result.error ? ` — ${result.error}` : ""}`,
      });
      if (result.ok) break;
    }
  } finally {
    g.__sentryEscalationBusy = false;
  }
}

export async function stopPhoneEscalation(incidentId: number) {
  const rows = await listDeliveries(incidentId);
  const provider = activePhoneProvider();
  for (const r of rows) {
    if (r.channel !== "PHONE_CALL") continue;
    if (!["PENDING", "SENT"].includes(r.status)) continue;
    if (r.providerId && provider?.cancelCall) {
      try {
        await provider.cancelCall(r.providerId);
      } catch {}
    }
  }
  await db
    .update(alertDeliveries)
    .set({ status: "ACKNOWLEDGED", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(alertDeliveries.incidentId, incidentId), eq(alertDeliveries.channel, "PHONE_CALL"), inArray(alertDeliveries.status, ["PENDING", "SENT"])));
}

export { updatePhoneDelivery, statusToState };
