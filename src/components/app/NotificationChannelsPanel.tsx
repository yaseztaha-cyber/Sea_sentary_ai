"use client";

import { useEffect, useState } from "react";
import { useEngine, useSettingsUpdater, useSnapshot } from "./SentryProvider";
import { Btn, Mono, Panel, Pill, Toggle } from "./ui";

type NotificationStatus = {
  webPush: { configured: boolean; enabled: boolean; publicKey: string | null; subscriptions: number; activeSubscriptions: number; lastSuccessAt: string | null; lastError: string | null; note: string };
  telegram: { configured: boolean; enabled: boolean; chatIdConfigured: boolean; note: string };
  phone: { provider: string | null; configured: boolean; enabled: boolean; autoCall: boolean; responders: number; invalidResponders: number; manualNumberConfigured: boolean; missingEnv: string[]; note: string; escalationSeconds: number; maxAttempts: number };
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationChannelsPanel() {
  const engine = useEngine();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const s = snap.settings.notifications;
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [telegramChatId, setTelegramChatId] = useState(s.telegram.chatId);
  const [phoneTestNumber, setPhoneTestNumber] = useState(s.phone.manualNumber);

  const loadStatus = async () => {
    try {
      const r = await fetch("/api/notifications/status", { cache: "no-store" });
      if (r.ok) setStatus((await r.json()) as NotificationStatus);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    const t = setTimeout(() => void loadStatus(), 0);
    return () => clearTimeout(t);
  }, []);

  const subscribePush = async () => {
    setBusy("push-subscribe");
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser does not support Web Push");
      const config = await (await fetch("/api/push/config", { cache: "no-store" })).json();
      if (!config.publicKey) throw new Error("VAPID public key is unavailable");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(`Notification permission: ${permission}`);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Subscription rejected");
      update((x) => (x.notifications.webPush.enabled = true));
      setMessage("Web Push subscription stored. Test it below.");
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unsubscribePush = async () => {
    setBusy("push-unsubscribe");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setMessage("Web Push subscription removed.");
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendPushTest = async () => {
    setBusy("push-test");
    setMessage("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const j = await res.json();
      setMessage(j.ok ? "Web Push test sent. Check the OS/browser notification center (app may be in the background)." : `Web Push test failed: ${JSON.stringify(j.results ?? j)}`);
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verifyTelegram = async () => {
    setBusy("telegram-verify");
    setMessage("");
    try {
      update((x) => (x.notifications.telegram.chatId = telegramChatId));
      const res = await fetch("/api/telegram/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: telegramChatId }) });
      const j = await res.json();
      setMessage(j.ok ? `Telegram verified: ${j.chat?.title ?? j.chat?.type ?? "chat"}` : `Telegram verification failed: ${j.error ?? "unknown error"}`);
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendTelegramTest = async () => {
    setBusy("telegram-test");
    setMessage("");
    try {
      const res = await fetch("/api/telegram/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: telegramChatId }) });
      const j = await res.json();
      setMessage(j.ok ? "Telegram test sent." : `Telegram test failed: ${JSON.stringify(j.results ?? j)}`);
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verifyPhone = async () => {
    setBusy("phone-verify");
    setMessage("");
    try {
      const res = await fetch("/api/phone/verify");
      const j = await res.json();
      setMessage(j.configured ? (j.ok ? `Phone provider verified: ${j.account?.friendlyName ?? j.provider}` : `Phone provider check failed: ${j.error ?? "unknown"}`) : j.error ?? "PHONE CALL NOT CONFIGURED");
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendPhoneTest = async () => {
    setBusy("phone-test");
    setMessage("");
    try {
      const res = await fetch("/api/phone/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: phoneTestNumber }) });
      const j = await res.json();
      setMessage(j.ok ? `Call initiated by provider: ${j.providerId ?? j.providerStatus}. Real outcome arrives via status callback.` : `Call not placed: ${j.error ?? JSON.stringify(j)}`);
      await loadStatus();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Notification channels & test center">
      <div className="space-y-4 p-4">
        <p className="text-[0.74rem] leading-relaxed text-mist">
          Web Push and Telegram are free. Phone calls are optional and require a configured telephony provider. A failure in one channel does not prevent the others.
        </p>
        {message && <p className="text-[0.74rem] text-mint">{message}</p>}

        <div className="rounded-[6px] border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.82rem] text-moon">Web Push</span>
            <Pill tone={status?.webPush.configured ? (status.webPush.activeSubscriptions > 0 ? "ok" : "warn") : "idle"}>{status?.webPush.configured ? `${status.webPush.activeSubscriptions} active` : "not configured"}</Pill>
          </div>
          <p className="mt-1 text-[0.72rem] text-mist">{status?.webPush.note}</p>
          <Toggle checked={s.webPush.enabled} onChange={(v) => update((x) => (x.notifications.webPush.enabled = v))} label="Enable Web Push for critical incidents" />
          <Toggle checked={s.webPush.includeEvidence} onChange={(v) => update((x) => (x.notifications.webPush.includeEvidence = v))} label="Include evidence link in push payload" hint="Payloads never contain camera images." />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => void subscribePush()} disabled={busy !== null}>Subscribe this browser</Btn>
            <Btn tone="quiet" onClick={() => void unsubscribePush()} disabled={busy !== null}>Unsubscribe</Btn>
            <Btn onClick={() => void sendPushTest()} disabled={busy !== null || !status?.webPush.configured}>Test push</Btn>
          </div>
          {status?.webPush.lastError && <p className="mt-2 text-[0.72rem] text-coral">{status.webPush.lastError}</p>}
        </div>

        <div className="rounded-[6px] border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.82rem] text-moon">Telegram bot</span>
            <Pill tone={status?.telegram.configured ? (s.telegram.enabled ? "ok" : "idle") : "idle"}>{status?.telegram.configured ? "configured" : "not configured"}</Pill>
          </div>
          <p className="mt-1 text-[0.72rem] text-mist">{status?.telegram.note}</p>
          <Toggle checked={s.telegram.enabled} onChange={(v) => update((x) => (x.notifications.telegram.enabled = v))} label="Enable Telegram notifications" />
          <input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="Telegram chat ID" className="mt-2 h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon outline-none focus:border-mint" />
          <Toggle checked={s.telegram.sendEvidence} onChange={(v) => update((x) => (x.notifications.telegram.sendEvidence = v))} label="Send evidence image" />
          <Toggle checked={s.telegram.sendAudio} onChange={(v) => update((x) => (x.notifications.telegram.sendAudio = v))} label="Send recorded voice message" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => void verifyTelegram()} disabled={busy !== null || !telegramChatId.trim()}>Verify chat</Btn>
            <Btn onClick={() => void sendTelegramTest()} disabled={busy !== null || !telegramChatId.trim()}>Send test</Btn>
          </div>
        </div>

        <div className="rounded-[6px] border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.82rem] text-moon">Phone calls</span>
            <Pill tone={status?.phone.configured ? "ok" : "alert"}>{status?.phone.configured ? status.phone.provider : "not configured"}</Pill>
          </div>
          <p className="mt-1 text-[0.72rem] text-mist">{status?.phone.note}</p>
          {!status?.phone.configured && <p className="mt-1 text-[0.74rem] text-coral">PHONE CALL NOT CONFIGURED</p>}
          <Toggle checked={s.phone.enabled} onChange={(v) => update((x) => (x.notifications.phone.enabled = v))} label="Enable phone channel" />
          <Toggle checked={s.phone.autoCall} onChange={(v) => update((x) => (x.notifications.phone.autoCall = v))} label="Automatic escalation calls" hint="Disabled by default. Requires configured and tested provider." />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[0.72rem] text-mist">Escalation delay (s)</span>
              <input type="number" min={10} max={600} value={s.phone.escalationSeconds} onChange={(e) => update((x) => (x.notifications.phone.escalationSeconds = Number(e.target.value)))} className="h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.72rem] text-mist">Max attempts</span>
              <input type="number" min={1} max={6} value={s.phone.maxAttempts} onChange={(e) => update((x) => (x.notifications.phone.maxAttempts = Number(e.target.value)))} className="h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon" />
            </label>
          </div>
          <textarea
            value={s.phone.responders.join("\n")}
            onChange={(e) => update((x) => (x.notifications.phone.responders = e.target.value.split(/\n+/).map((v) => v.trim()).filter(Boolean)))}
            placeholder="Responder phone numbers (E.164, one per line)"
            className="mt-2 h-24 w-full rounded-[5px] border border-line bg-depth/60 p-2 font-mono text-[0.78rem] text-moon"
          />
          <input value={phoneTestNumber} onChange={(e) => setPhoneTestNumber(e.target.value)} placeholder="Manual test number (E.164)" className="mt-2 h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => void verifyPhone()} disabled={busy !== null}>Verify provider</Btn>
            <Btn onClick={() => void sendPhoneTest()} disabled={busy !== null || !phoneTestNumber.trim()}>Test call</Btn>
          </div>
          {status?.phone.missingEnv?.length ? <p className="mt-2 text-[0.72rem] text-coral">Missing: {status.phone.missingEnv.join(", ")}</p> : null}
          {status?.phone.invalidResponders ? <p className="mt-2 text-[0.72rem] text-coral">{status.phone.invalidResponders} responder number(s) are invalid.</p> : null}
        </div>

        <p className="text-[0.68rem] text-mist">
          Web Push: permission state {typeof Notification !== "undefined" ? Notification.permission : "unknown"}. Telegram messages are never described as phone calls. Mobile one-tap dialing is available in the incident UI when no provider is configured.
        </p>
      </div>
    </Panel>
  );
}
