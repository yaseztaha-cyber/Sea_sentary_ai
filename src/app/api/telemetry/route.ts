import { publish } from "@/lib/server/bus";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["camera.state", "ai.update", "heatmap.updated"]);

// The camera and AI run in the operator's browser; their real measured state is relayed over the
// same event stream so every open console window updates without refreshing.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.type !== "string" || !ALLOWED.has(b.type)) {
    return Response.json({ error: "Unsupported telemetry type" }, { status: 400 });
  }
  publish(b.type, b.data ?? {});
  return Response.json({ ok: true });
}
