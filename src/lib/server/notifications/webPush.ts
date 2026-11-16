import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "web-push";
import { configureVapid } from "./vapid";
import type { ChannelResult, IncidentAlert } from "./types";

/**
 * Web Push sender. This is a genuine VAPID Web Push delivery to the browser's
 * push service; the service worker displays the notification. Payloads are
 * deliberately small and contain no camera imagery or private footage.
 *
 * Local development caveat: a powered-off machine or a stopped Next.js server
 * cannot send anything. Production requires a reachable, always-on backend and
 * HTTPS (except localhost).
 */

const PUBLIC_BASE = () => (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

export function pushPayload(alert: IncidentAlert) {
  return {
    type: "sentry.incident.critical",
    incidentId: alert.incidentId,
    ref: alert.ref,
    title: "CRITICAL — Possible swimmer distress",
    camera: alert.camera,
    zone: alert.zone,
    at: alert.createdAt,
    url: alert.incidentUrl,
    tag: `sentry-${alert.ref}`,
    test: alert.isTest,
  };
}

export async function sendWebPushAlert(alert: IncidentAlert): Promise<ChannelResult[]> {
  const vapid = await configureVapid();
  if (!vapid) {
    return [{ channel: "WEB_PUSH", status: "NOT_CONFIGURED", recipient: "all", providerId: null, providerStatus: null, error: "VAPID keys unavailable" }];
  }
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.revoked, false));
  if (!subs.length) {
    return [{ channel: "WEB_PUSH", status: "NOT_CONFIGURED", recipient: "all", providerId: null, providerStatus: null, error: "No active push subscription" }];
  }
  const payload = JSON.stringify(pushPayload(alert));
  const results: ChannelResult[] = [];
  for (const sub of subs) {
    const recipient = `push:${sub.id}`;
    try {
      const res = await sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 300, urgency: "high", topic: alert.ref.slice(0, 32) },
      );
      await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), lastError: null }).where(eq(pushSubscriptions.id, sub.id));
      results.push({ channel: "WEB_PUSH", status: "SENT", recipient, providerId: String(res.statusCode), providerStatus: `http ${res.statusCode}`, error: null, detail: { endpointHost: safeHost(sub.endpoint) } });
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const code = err.statusCode ?? 0;
      const expired = code === 404 || code === 410;
      const message = expired ? `subscription expired (${code})` : err.message ?? "push delivery failed";
      if (expired) await db.update(pushSubscriptions).set({ revoked: true, lastError: message }).where(eq(pushSubscriptions.id, sub.id));
      else await db.update(pushSubscriptions).set({ lastError: message }).where(eq(pushSubscriptions.id, sub.id));
      results.push({ channel: "WEB_PUSH", status: "FAILED", recipient, providerId: code ? String(code) : null, providerStatus: expired ? "EXPIRED" : "ERROR", error: message, detail: { endpointHost: safeHost(sub.endpoint) } });
    }
  }
  return results;
}

export async function pushStatus() {
  const vapid = await configureVapid();
  const rows = await db.select().from(pushSubscriptions);
  const active = rows.filter((r) => !r.revoked);
  const last = active.slice().sort((a, b) => (b.lastSuccessAt?.getTime() ?? 0) - (a.lastSuccessAt?.getTime() ?? 0))[0];
  return {
    configured: !!vapid,
    publicKey: vapid?.publicKey ?? null,
    subscriptions: rows.length,
    activeSubscriptions: active.length,
    lastSuccessAt: last?.lastSuccessAt?.toISOString() ?? null,
    lastError: active.find((r) => r.lastError)?.lastError ?? null,
  };
}

export async function saveSubscription(input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) {
  if (!/^https:\/\//i.test(input.endpoint)) throw new Error("Push endpoint must be an HTTPS URL");
  if (!input.keys?.p256dh || !input.keys?.auth) throw new Error("Push subscription keys are missing");
  if (input.endpoint.length > 4096 || input.keys.p256dh.length > 512 || input.keys.auth.length > 512) throw new Error("Push subscription is too large");
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: (input.userAgent ?? "").slice(0, 300), revoked: false })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: (input.userAgent ?? "").slice(0, 300), revoked: false },
    })
    .returning();
  return row;
}

export async function revokeSubscription(input: { id?: number; endpoint?: string }) {
  if (typeof input.id === "number") {
    await db.update(pushSubscriptions).set({ revoked: true }).where(eq(pushSubscriptions.id, input.id));
    return true;
  }
  if (input.endpoint) {
    await db.update(pushSubscriptions).set({ revoked: true }).where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.revoked, false)));
    return true;
  }
  return false;
}

function safeHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

export { PUBLIC_BASE };
