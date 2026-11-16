import { readManifest } from "@/lib/server/audioStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await readManifest());
}
