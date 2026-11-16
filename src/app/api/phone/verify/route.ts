import { activePhoneProvider, phoneConfigStatus } from "@/lib/server/notifications/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = phoneConfigStatus();
  const provider = activePhoneProvider();
  if (!provider) {
    return Response.json({ configured: false, provider: null, error: "PHONE CALL NOT CONFIGURED", missing: config.missing }, { status: 200 });
  }
  const result = await provider.verify();
  return Response.json({
    configured: true,
    provider: provider.id,
    ok: result.ok,
    error: result.error,
    account: result.account
      ? {
          friendlyName: result.account.friendly_name ?? null,
          status: result.account.status ?? null,
          type: result.account.type ?? null,
          trial: String(result.account.type ?? "").toLowerCase() === "trial",
        }
      : null,
    balance: result.balance
      ? { balance: result.balance.balance ?? null, currency: result.balance.currency ?? null }
      : null,
    trialNote: "Trial accounts can only call verified recipient numbers and may prepend a trial message. Paid calling is required after trial credit.",
  });
}
