import { activePhoneProvider, isEmergencyNumber, normalizePhoneNumber } from "@/lib/server/notifications/phone";
import { loadServerSettings } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const settings = await loadServerSettings();
  const raw = String(body?.to ?? settings.notifications.phone.manualNumber ?? settings.notifications.phone.responders[0] ?? "").trim();
  if (!raw) return Response.json({ ok: false, error: "A recipient phone number is required" }, { status: 400 });
  if (isEmergencyNumber(raw)) return Response.json({ ok: false, error: "Public emergency numbers cannot be called by this system" }, { status: 400 });
  const to = normalizePhoneNumber(raw);
  if (!to) return Response.json({ ok: false, error: "Invalid phone number; use E.164 format (for example +15551234567)" }, { status: 400 });
  const provider = activePhoneProvider();
  if (!provider) return Response.json({ ok: false, error: "PHONE CALL NOT CONFIGURED", provider: null }, { status: 503 });
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) return Response.json({ ok: false, error: "PUBLIC_BASE_URL is required so the provider can fetch the recorded audio" }, { status: 503 });
  const secret = process.env.TWILIO_STATUS_SECRET?.trim();
  const result = await provider.placeCall({
    to,
    incidentId: 0,
    incidentRef: "TEST-CALL",
    idempotencyKey: `test:${Date.now()}:${to}`,
    twimlUrl: `${base}/api/phone/twiml?test=1`,
    statusCallbackUrl: `${base}/api/phone/webhook?incident=0&recipient=${encodeURIComponent(to)}${secret ? `&token=${encodeURIComponent(secret)}` : ""}`,
  });
  return Response.json(
    {
      ok: result.ok,
      state: result.state,
      providerId: result.providerId,
      providerStatus: result.providerStatus,
      error: result.error,
      note: result.ok ? "Provider accepted the call request. This is not proof that the call was answered; status callbacks report the real outcome." : "The provider rejected the call.",
    },
    { status: result.ok ? 202 : 502 },
  );
}
