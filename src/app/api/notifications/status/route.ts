import { loadServerSettings } from "@/lib/server/notifications/dispatcher";
import { pushStatus } from "@/lib/server/notifications/webPush";
import { telegramConfigured } from "@/lib/server/notifications/telegram";
import { phoneConfigStatus, validateResponders } from "@/lib/server/notifications/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const settings = await loadServerSettings();
  const push = await pushStatus();
  const phone = phoneConfigStatus();
  const responders = validateResponders(settings.notifications.phone.responders);
  return Response.json({
    webPush: {
      configured: push.configured,
      enabled: settings.notifications.webPush.enabled,
      publicKey: push.publicKey,
      subscriptions: push.subscriptions,
      activeSubscriptions: push.activeSubscriptions,
      lastSuccessAt: push.lastSuccessAt,
      lastError: push.lastError,
      note: "Push is delivered by this server to the browser push service. It cannot run while the machine/backend is off.",
    },
    telegram: {
      configured: telegramConfigured(),
      enabled: settings.notifications.telegram.enabled,
      chatIdConfigured: !!settings.notifications.telegram.chatId.trim(),
      note: "Telegram messages require a server-side bot token and an operator-started chat.",
    },
    phone: {
      provider: phone.provider,
      configured: phone.configured,
      enabled: settings.notifications.phone.enabled,
      autoCall: settings.notifications.phone.autoCall,
      responders: responders.valid.length,
      invalidResponders: responders.invalid.length,
      manualNumberConfigured: !!settings.notifications.phone.manualNumber.trim(),
      missingEnv: phone.missing,
      note: phone.configured
        ? "Calls are placed only by the configured telephony provider. Trial accounts require verified recipients and paid calling after trial credit."
        : "PHONE CALL NOT CONFIGURED",
      escalationSeconds: settings.notifications.phone.escalationSeconds,
      maxAttempts: settings.notifications.phone.maxAttempts,
    },
  });
}
