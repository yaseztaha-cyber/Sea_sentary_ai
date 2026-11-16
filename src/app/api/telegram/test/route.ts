import { sendTelegramTest } from "@/lib/server/notifications/telegram";
import { loadServerSettings } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const settings = await loadServerSettings();
  const chatId = (typeof body?.chatId === "string" ? body.chatId : settings.notifications.telegram.chatId).trim();
  if (!chatId) return Response.json({ ok: false, error: "A Telegram chat ID is required" }, { status: 400 });
  const results = await sendTelegramTest(chatId);
  return Response.json({ ok: results.every((r) => r.status === "SENT"), results });
}
