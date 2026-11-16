import { verifyTelegram } from "@/lib/server/notifications/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
  if (!chatId) return Response.json({ error: "A Telegram chat ID is required" }, { status: 400 });
  const result = await verifyTelegram(chatId);
  return Response.json(result, { status: result.ok ? 200 : result.configured ? 400 : 503 });
}
