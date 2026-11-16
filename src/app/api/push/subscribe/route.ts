import { revokeSubscription, saveSubscription } from "@/lib/server/notifications/webPush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return Response.json({ error: "A PushSubscription with endpoint and keys is required" }, { status: 400 });
  }
  try {
    const row = await saveSubscription({
      endpoint: String(body.endpoint),
      keys: { p256dh: String(body.keys.p256dh), auth: String(body.keys.auth) },
      userAgent: req.headers.get("user-agent") ?? "",
    });
    return Response.json({ ok: true, id: row.id, endpointHost: safeHost(row.endpoint) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const id = Number(body?.id ?? url.searchParams.get("id"));
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : url.searchParams.get("endpoint") ?? undefined;
  const ok = await revokeSubscription({ id: Number.isFinite(id) && id > 0 ? id : undefined, endpoint });
  return Response.json({ ok });
}

function safeHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
