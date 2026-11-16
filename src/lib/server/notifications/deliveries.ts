import { db } from "@/db";
import { alertDeliveries, incidentEvents } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DeliveryChannel, DeliveryStatus } from "./types";

export type DeliveryInput = {
  incidentId: number;
  channel: DeliveryChannel;
  recipient?: string;
  phase?: string;
  status: DeliveryStatus;
  attempts?: number;
  providerId?: string | null;
  providerStatus?: string | null;
  error?: string | null;
  payload?: Record<string, unknown>;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
};

/**
 * Idempotent delivery record. The unique (incident, channel, recipient, phase)
 * index is the duplicate-suppression key: an SSE reconnection, reload, retry or
 * second model frame cannot create a second record for the same attempt.
 */
export async function recordDelivery(input: DeliveryInput) {
  const recipient = input.recipient ?? "default";
  const phase = input.phase ?? "CREATED";
  const now = new Date();
  const [row] = await db
    .insert(alertDeliveries)
    .values({
      incidentId: input.incidentId,
      channel: input.channel,
      recipient,
      phase,
      status: input.status,
      attempts: input.attempts ?? 1,
      providerId: input.providerId ?? null,
      providerStatus: input.providerStatus ?? null,
      error: input.error ?? null,
      payload: input.payload ?? {},
      sentAt: input.sentAt ?? (input.status === "SENT" || input.status === "DELIVERED" ? now : null),
      deliveredAt: input.deliveredAt ?? (input.status === "DELIVERED" ? now : null),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [alertDeliveries.incidentId, alertDeliveries.channel, alertDeliveries.recipient, alertDeliveries.phase],
      set: {
        status: input.status,
        providerId: input.providerId ?? null,
        providerStatus: input.providerStatus ?? null,
        error: input.error ?? null,
        payload: input.payload ?? {},
        attempts: sql`${alertDeliveries.attempts} + 1`,
        sentAt: input.sentAt ?? (input.status === "SENT" || input.status === "DELIVERED" ? now : null),
        deliveredAt: input.deliveredAt ?? (input.status === "DELIVERED" ? now : null),
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function listDeliveries(incidentId: number) {
  return db.select().from(alertDeliveries).where(eq(alertDeliveries.incidentId, incidentId)).orderBy(asc(alertDeliveries.createdAt), asc(alertDeliveries.id));
}

export async function findDelivery(incidentId: number, channel: DeliveryChannel, recipient: string, phase: string) {
  const [row] = await db
    .select()
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.incidentId, incidentId),
        eq(alertDeliveries.channel, channel),
        eq(alertDeliveries.recipient, recipient),
        eq(alertDeliveries.phase, phase),
      ),
    );
  return row ?? null;
}

export async function acknowledgeDeliveries(incidentId: number) {
  const now = new Date();
  await db
    .update(alertDeliveries)
    .set({ status: "ACKNOWLEDGED", acknowledgedAt: now, updatedAt: now })
    .where(and(eq(alertDeliveries.incidentId, incidentId), inArray(alertDeliveries.status, ["PENDING", "SENT", "DELIVERED"])));
  await db.insert(incidentEvents).values({
    incidentId,
    type: "ALERT_ACKNOWLEDGED",
    message: "Operator acknowledged the incident: pending remote notifications and phone escalation were stopped.",
  });
}

export async function updatePhoneDelivery(input: {
  incidentId: number;
  recipient: string;
  providerId?: string | null;
  providerStatus: string;
  status?: DeliveryStatus;
  error?: string | null;
}) {
  const rows = await db
    .select()
    .from(alertDeliveries)
    .where(and(eq(alertDeliveries.incidentId, input.incidentId), eq(alertDeliveries.channel, "PHONE_CALL"), eq(alertDeliveries.recipient, input.recipient)));
  if (!rows.length) return null;
  const row = rows[rows.length - 1];
  const now = new Date();
  const delivered = input.status === "DELIVERED";
  await db
    .update(alertDeliveries)
    .set({
      providerId: input.providerId ?? row.providerId,
      providerStatus: input.providerStatus,
      status: input.status ?? row.status,
      error: input.error ?? row.error,
      deliveredAt: delivered ? now : row.deliveredAt,
      updatedAt: now,
    })
    .where(eq(alertDeliveries.id, row.id));
  const stateLabel = input.providerStatus.toLowerCase().replace(/_/g, " ");
  await db.insert(incidentEvents).values({
    incidentId: input.incidentId,
    type: "PHONE_STATUS",
    message: `Phone call to ${redactPhone(input.recipient)}: ${stateLabel}${input.providerId ? ` · provider call ${input.providerId}` : ""}${input.error ? ` · ${input.error}` : ""}`,
  });
  return { ...row, status: input.status ?? row.status, providerStatus: input.providerStatus };
}

export function redactPhone(n: string) {
  const digits = n.replace(/[^\d+]/g, "");
  if (digits.length <= 6) return "***";
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}
