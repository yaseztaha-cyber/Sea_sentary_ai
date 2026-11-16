import { listDeliveries, recordDelivery } from "@/lib/server/notifications/deliveries";
import type { DeliveryChannel, DeliveryStatus } from "@/lib/server/notifications/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL_CHANNELS: DeliveryChannel[] = ["LOCAL_SIREN", "LOCAL_VOICE"];
const STATUSES: DeliveryStatus[] = ["PENDING", "SENT", "DELIVERED", "ACKNOWLEDGED", "FAILED", "DISABLED", "NOT_CONFIGURED"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json(await listDeliveries(Number(id)));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || !LOCAL_CHANNELS.includes(body.channel) || !STATUSES.includes(body.status)) {
    return Response.json({ error: "Local channel and valid status are required" }, { status: 400 });
  }
  const row = await recordDelivery({
    incidentId: Number(id),
    channel: body.channel,
    recipient: "local-console",
    phase: typeof body.phase === "string" ? body.phase.slice(0, 24) : "CREATED",
    status: body.status,
    providerStatus: typeof body.providerStatus === "string" ? body.providerStatus.slice(0, 60) : null,
    error: typeof body.error === "string" ? body.error.slice(0, 500) : null,
    payload: typeof body.payload === "object" && body.payload ? (body.payload as Record<string, unknown>) : {},
  });
  return Response.json({ ok: true, id: row.id, status: row.status }, { status: 201 });
}
