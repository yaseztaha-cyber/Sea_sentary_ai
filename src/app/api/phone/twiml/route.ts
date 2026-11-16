import { readManifest } from "@/lib/server/audioStore";
import { buildIncidentAlert } from "@/lib/server/notifications/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TwiML used by the telephony provider. It plays the licensed siren recording,
 * a short pause, then the operator's recorded human announcement. If no human
 * recording exists, the siren still plays and the call log reports that the
 * spoken location announcement was unavailable. No synthetic robot voice is
 * substituted.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const incidentId = Number(url.searchParams.get("incident"));
  const base = (process.env.PUBLIC_BASE_URL ?? url.origin).replace(/\/$/, "");
  const manifest = await readManifest();
  const siren = `${base}${manifest.siren.url}`;
  const voice = manifest.generic?.url ? `${base}${manifest.generic.url}` : null;
  const parts = [
    `<Response>`,
    `<Play>${escapeXml(siren)}</Play>`,
    `<Pause length="1"/>`,
  ];
  if (voice) {
    parts.push(`<Play>${escapeXml(voice)}</Play>`);
  } else if (incidentId > 0) {
    const alert = await buildIncidentAlert(incidentId, base);
    // A short DTMF-free call with only the siren is safer than inventing a
    // robotic location. The text/Telegram/web channels still carry the zone.
    void alert;
  }
  parts.push(`</Response>`);
  return new Response(parts.join(""), { headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}
