import { readRecording } from "@/lib/server/audioStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const role = new URL(req.url).searchParams.get("role") ?? "";
  const file = await readRecording(role);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600", "Content-Length": String(file.buffer.length) },
  });
}
