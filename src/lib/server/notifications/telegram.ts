import { readRecording } from "@/lib/server/audioStore";
import type { Settings } from "@/lib/settings";
import type { ChannelResult, IncidentAlert } from "./types";

/**
 * Telegram Bot API integration (server only). The bot token is read from the
 * TELEGRAM_BOT_TOKEN environment variable and is never returned to the browser.
 * A Telegram message is a Telegram message — it is never described as a phone call.
 */

const API_BASE = () => (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "");
const lastSent = new Map<string, number>();
const MIN_INTERVAL_MS = 2500;

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

function token() {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return t;
}

async function api(method: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE()}/bot${token()}/${method}`, { ...init, signal: controller.signal, cache: "no-store" });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok && body.ok === true, status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyTelegram(chatId: string) {
  if (!telegramConfigured()) return { ok: false, configured: false, error: "TELEGRAM_BOT_TOKEN is not configured on the server", chat: null, bot: null };
  const me = await api("getMe");
  if (!me.ok) return { ok: false, configured: true, error: describe(me.body, "Bot token rejected"), chat: null, bot: null };
  const chat = await api("getChat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId }) });
  if (!chat.ok) return { ok: false, configured: true, error: describe(chat.body, "Chat not reachable by this bot"), chat: null, bot: (me.body.result as Record<string, unknown>) ?? null };
  const c = chat.body.result as Record<string, unknown>;
  return {
    ok: true,
    configured: true,
    error: null,
    chat: { id: c.id, type: c.type, title: c.title ?? c.username ?? null },
    bot: { id: (me.body.result as Record<string, unknown>)?.id, username: (me.body.result as Record<string, unknown>)?.username ?? null },
  };
}

export async function sendTelegramAlert(alert: IncidentAlert, settings: Settings, opts: { force?: boolean } = {}): Promise<ChannelResult[]> {
  if (!telegramConfigured()) {
    return [{ channel: "TELEGRAM", status: "NOT_CONFIGURED", recipient: "telegram", providerId: null, providerStatus: null, error: "TELEGRAM_BOT_TOKEN is not configured" }];
  }
  const chatId = settings.notifications.telegram.chatId.trim();
  if (!chatId) {
    return [{ channel: "TELEGRAM", status: "NOT_CONFIGURED", recipient: "telegram", providerId: null, providerStatus: null, error: "Telegram chat ID is not configured" }];
  }
  if (!settings.notifications.telegram.enabled && !opts.force) {
    return [{ channel: "TELEGRAM", status: "DISABLED", recipient: chatId, providerId: null, providerStatus: null, error: "Telegram channel disabled in Settings" }];
  }
  const prev = lastSent.get(chatId) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - prev);
  if (wait > 0) {
    return [{ channel: "TELEGRAM", status: "FAILED", recipient: chatId, providerId: null, providerStatus: "RATE_LIMITED", error: `Local rate limit: retry in ${Math.ceil(wait / 1000)}s` }];
  }
  lastSent.set(chatId, Date.now());

  const text = [
    `<b>CRITICAL — Possible swimmer distress</b>`,
    `Incident: <code>${escapeHtml(alert.ref)}</code>`,
    `Camera: ${escapeHtml(alert.camera)}`,
    `Zone: ${escapeHtml(alert.zone ?? "not zoned")}`,
    `Time: ${escapeHtml(new Date(alert.createdAt).toLocaleString())}`,
    "",
    "This is a screening alert, not a confirmed drowning. Lifeguard review required.",
  ].join("\n");
  const keyboard = { inline_keyboard: [[{ text: "Open incident", url: alert.incidentUrl }]] };
  const message = await api("sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard }),
  });
  if (!message.ok) {
    return [{ channel: "TELEGRAM", status: "FAILED", recipient: chatId, providerId: null, providerStatus: String(message.body.error_code ?? message.status), error: describe(message.body, "Telegram sendMessage failed") }];
  }
  const messageId = (message.body.result as Record<string, unknown> | undefined)?.message_id;
  const detail: Record<string, unknown> = { messageId };

  if (settings.notifications.telegram.sendEvidence && alert.evidenceDataUrl) {
    try {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", `Evidence snapshot for ${alert.ref}`);
      const blob = dataUrlToBlob(alert.evidenceDataUrl);
      if (blob && blob.size <= 8_000_000) {
        form.set("photo", blob, "incident.jpg");
        const photo = await api("sendPhoto", { method: "POST", body: form }, 15000);
        detail.photo = photo.ok ? "sent" : describe(photo.body, "sendPhoto failed");
      }
    } catch (e) {
      detail.photo = `failed: ${(e as Error).message}`;
    }
  }
  if (settings.notifications.telegram.sendAudio) {
    try {
      const rec = await readRecording("critical_generic");
      if (rec) {
        const form = new FormData();
        form.set("chat_id", chatId);
        form.set("caption", `Recorded critical announcement for ${alert.ref}`);
        form.set("audio", new Blob([new Uint8Array(rec.buffer)], { type: rec.mime }), "announcement");
        const audio = await api("sendAudio", { method: "POST", body: form }, 20000);
        detail.audio = audio.ok ? "sent" : describe(audio.body, "sendAudio failed");
      } else {
        detail.audio = "no recorded generic announcement";
      }
    } catch (e) {
      detail.audio = `failed: ${(e as Error).message}`;
    }
  }
  return [{ channel: "TELEGRAM", status: "SENT", recipient: chatId, providerId: messageId != null ? String(messageId) : null, providerStatus: "API_ACCEPTED", error: null, detail }];
}

export async function sendTelegramTest(chatId: string) {
  const alert: IncidentAlert = {
    incidentId: -1,
    ref: "TEST-TELEGRAM",
    severity: "CRITICAL",
    status: "TEST",
    title: "Telegram test",
    camera: "Settings test",
    zone: "test",
    trackId: null,
    isTest: true,
    createdAt: new Date().toISOString(),
    incidentUrl: `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/app/settings`,
    evidenceDataUrl: null,
    evidenceAvailable: false,
  };
  const fakeSettings = { notifications: { telegram: { enabled: true, chatId, sendEvidence: false, sendAudio: false } } } as unknown as Settings;
  return sendTelegramAlert(alert, fakeSettings, { force: true });
}

function describe(body: Record<string, unknown>, fallback: string) {
  const d = typeof body.description === "string" ? body.description : fallback;
  return `${d}${body.error_code ? ` (${body.error_code})` : ""}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  return new Blob([new Uint8Array(buf)], { type: m[1] });
}
