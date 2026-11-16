import { updatePhoneDelivery } from "@/lib/server/notifications/deliveries";
import { statusToState, validTwilioSignature } from "@/lib/server/notifications/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DELIVERED_STATES = new Set(["answered", "completed"]);

/**
 * Provider call-status callback. Only the provider's own status updates a call
 * to ANSWERED/COMPLETED/DELIVERED. Sending an API request is never treated as a
 * successful call.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const signature = req.headers.get("x-twilio-signature");
  const secret = process.env.TWILIO_STATUS_SECRET?.trim();
  const tokenOk = secret ? url.searchParams.get("token") === secret : validTwilioSignature(url.toString(), params, signature);
  if (!tokenOk) return new Response("Invalid signature", { status: 403 });

  const incidentId = Number(url.searchParams.get("incident"));
  const recipient = url.searchParams.get("recipient") ?? params.To ?? "";
  const providerStatus = (params.CallStatus ?? params.SmsStatus ?? "unknown").toLowerCase();
  const providerId = params.CallSid ?? params.SmsSid ?? null;
  if (!incidentId || !recipient) return new Response("Missing incident or recipient", { status: 400 });

  const state = statusToState(providerStatus);
  const status = DELIVERED_STATES.has(providerStatus) ? "DELIVERED" : state === "FAILED" || state === "BUSY" || state === "NO_ANSWER" || state === "CANCELED" ? "FAILED" : "SENT";
  await updatePhoneDelivery({
    incidentId,
    recipient,
    providerId,
    providerStatus,
    status,
    error: status === "FAILED" ? `Provider reported ${providerStatus}` : null,
  });
  return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
}

export async function GET() {
  return Response.json({ ok: true, note: "Twilio status callback endpoint; POST only" });
}
