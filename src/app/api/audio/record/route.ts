import { deleteRecording, saveRecording } from "@/lib/server/audioStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.role !== "string" || typeof body.dataUrl !== "string") {
    return Response.json({ error: "role and dataUrl are required" }, { status: 400 });
  }
  try {
    const asset = await saveRecording({
      role: body.role,
      label: typeof body.label === "string" ? body.label : undefined,
      zoneId: typeof body.zoneId === "number" ? body.zoneId : null,
      zoneName: typeof body.zoneName === "string" ? body.zoneName : null,
      dataUrl: body.dataUrl,
    });
    return Response.json({ ok: true, asset: { ...asset, url: `/api/audio/file?role=${encodeURIComponent(asset.role)}&v=${encodeURIComponent(asset.recordedAt)}` } }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const role = new URL(req.url).searchParams.get("role");
  if (!role) return Response.json({ error: "role is required" }, { status: 400 });
  try {
    return Response.json({ ok: await deleteRecording(role) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
