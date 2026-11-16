import { sendWebPushAlert } from "@/lib/server/notifications/webPush";
import { buildIncidentAlert } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true });
}

export async function POST() {
  const alert = (await buildIncidentAlert(-1)) ?? {
    incidentId: -1,
    ref: "TEST-PUSH",
    severity: "CRITICAL",
    status: "TEST",
    title: "Web Push test",
    camera: "Settings test",
    zone: "test",
    trackId: null,
    isTest: true,
    createdAt: new Date().toISOString(),
    incidentUrl: `${(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/settings`,
    evidenceDataUrl: null,
    evidenceAvailable: false,
  };
  const results = await sendWebPushAlert({ ...alert, ref: "TEST-PUSH", isTest: true, title: "Web Push test", zone: "test", incidentUrl: `${(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/settings` });
  return Response.json({ ok: results.every((r) => r.status === "SENT"), results });
}
