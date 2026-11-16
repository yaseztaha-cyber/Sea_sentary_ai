/* Sea Sentry service worker — Web Push delivery only. */
const CACHE_NAME = "sea-sentry-sw-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "CRITICAL — Possible swimmer distress", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CRITICAL — Possible swimmer distress";
  const body = data.body || (data.zone ? `Camera ${data.camera ?? ""} · Zone ${data.zone}` : "Possible swimmer distress — lifeguard review required.");
  const incidentId = data.incidentId;
  const url = data.url || (incidentId ? `/app/incidents?id=${incidentId}` : "/app");
  const options = {
    body,
    icon: "/branding/logo-light.svg",
    badge: "/branding/logo-light.svg",
    tag: data.tag || `sentry-${incidentId ?? "critical"}`,
    renotify: true,
    requireInteraction: true,
    timestamp: data.at ? Date.parse(data.at) : Date.now(),
    data: { incidentId, url, camera: data.camera, zone: data.zone, at: data.at },
    actions: [
      { action: "open", title: "Open incident" },
      { action: "acknowledge", title: "Acknowledge" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/app";
  if (event.action === "acknowledge" && data.incidentId) {
    event.waitUntil(
      fetch(`/api/incidents/${data.incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      }).catch(() => {}),
    );
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const target = clients.find((c) => c.url.includes("/app"));
      if (target) {
        await target.focus();
        target.postMessage({ type: "sentry.openIncident", incidentId: data.incidentId, url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/config", { cache: "no-store" });
        if (!res.ok) return;
        const cfg = await res.json();
        if (!cfg.publicKey) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub),
        });
      } catch (e) {
        // The page will retry subscription on next visit.
      }
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
