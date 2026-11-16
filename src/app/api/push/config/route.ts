import { getVapid } from "@/lib/server/notifications/vapid";
import { pushStatus } from "@/lib/server/notifications/webPush";
import { loadServerSettings } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const vapid = await getVapid();
  const settings = await loadServerSettings();
  const status = await pushStatus();
  return Response.json({
    configured: !!vapid,
    enabled: settings.notifications.webPush.enabled,
    publicKey: vapid?.publicKey ?? null,
    keySource: vapid?.source ?? null,
    subscriptions: status.subscriptions,
    activeSubscriptions: status.activeSubscriptions,
    note: "Web Push requires this backend to be running and reachable. A powered-off machine cannot send notifications.",
  });
}
