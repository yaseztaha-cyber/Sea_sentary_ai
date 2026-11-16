import fs from "node:fs/promises";
import path from "node:path";

export type AudioAsset = {
  role: string;
  label: string;
  zoneId: number | null;
  zoneName: string | null;
  file: string;
  mime: string;
  size: number;
  recordedAt: string;
  recordedBy: string;
  url?: string;
};

export type AudioManifest = {
  generic: AudioAsset | null;
  zones: Record<string, AudioAsset>;
  siren: { url: string; license: string; source: string; recorded: false };
};

const ROOT = path.join(process.cwd(), "data", "audio");
const MANIFEST = path.join(ROOT, "manifest.json");
const SIREN = "/audio/siren-whelen.ogg";
const ALLOWED = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4"]);

async function ensure() {
  await fs.mkdir(ROOT, { recursive: true });
}

export async function readManifest(): Promise<AudioManifest> {
  await ensure();
  let parsed: { generic?: AudioAsset; zones?: Record<string, AudioAsset> } = {};
  try {
    parsed = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  } catch {}
  const withUrl = (a: AudioAsset | undefined) =>
    a ? { ...a, url: `/api/audio/file?role=${encodeURIComponent(a.role)}&v=${encodeURIComponent(a.recordedAt)}` } : undefined;
  const zones: Record<string, AudioAsset & { url?: string }> = {};
  for (const [k, v] of Object.entries(parsed.zones ?? {})) {
    const u = withUrl(v);
    if (u) zones[k] = u;
  }
  const generic = withUrl(parsed.generic);
  return {
    generic: generic ?? null,
    zones,
    siren: {
      url: SIREN,
      license: "CC0 1.0 Universal Public Domain Dedication",
      source: "https://commons.wikimedia.org/wiki/File:Whelen.ogg",
      recorded: false,
    },
  };
}

export function normalizeRole(role: string): string | null {
  if (role === "critical_generic") return role;
  const m = /^zone_(\d{1,12})$/.exec(role);
  return m ? role : null;
}

export async function saveRecording(input: {
  role: string;
  label?: string;
  zoneId?: number | null;
  zoneName?: string | null;
  dataUrl: string;
}): Promise<AudioAsset> {
  const role = normalizeRole(input.role);
  if (!role) throw new Error("Invalid audio role");
  const m = /^data:([^;]+);base64,(.+)$/.exec(input.dataUrl);
  if (!m) throw new Error("Expected a base64 data URL");
  const mime = m[1].toLowerCase();
  if (!ALLOWED.has(mime)) throw new Error(`Unsupported audio MIME type: ${mime}`);
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100 || buf.length > 6_000_000) throw new Error("Recording must be between 100 bytes and 6 MB");
  await ensure();
  const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : "wav";
  const file = `${role}.${ext}`;
  await fs.writeFile(path.join(ROOT, file), buf);
  const asset: AudioAsset = {
    role,
    label: input.label?.slice(0, 120) || (role === "critical_generic" ? "Generic critical announcement" : `Zone announcement ${input.zoneName ?? role}`),
    zoneId: typeof input.zoneId === "number" ? input.zoneId : null,
    zoneName: input.zoneName?.slice(0, 120) ?? null,
    file,
    mime,
    size: buf.length,
    recordedAt: new Date().toISOString(),
    recordedBy: "local operator recording",
  };
  const current = await readManifestRaw();
  if (role === "critical_generic") current.generic = asset;
  else current.zones[role] = asset;
  await fs.writeFile(MANIFEST, JSON.stringify(current, null, 2));
  return asset;
}

async function readManifestRaw(): Promise<{ generic?: AudioAsset; zones: Record<string, AudioAsset> }> {
  await ensure();
  try {
    const j = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
    return { generic: j.generic, zones: j.zones ?? {} };
  } catch {
    return { zones: {} };
  }
}

export async function deleteRecording(role: string): Promise<boolean> {
  const r = normalizeRole(role);
  if (!r) throw new Error("Invalid audio role");
  const current = await readManifestRaw();
  const asset = r === "critical_generic" ? current.generic : current.zones[r];
  if (!asset) return false;
  try {
    await fs.unlink(path.join(ROOT, asset.file));
  } catch {}
  if (r === "critical_generic") delete current.generic;
  else delete current.zones[r];
  await fs.writeFile(MANIFEST, JSON.stringify(current, null, 2));
  return true;
}

export async function readRecording(role: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const r = normalizeRole(role);
  if (!r) return null;
  const current = await readManifestRaw();
  const asset = r === "critical_generic" ? current.generic : current.zones[r];
  if (!asset) return null;
  try {
    return { buffer: await fs.readFile(path.join(ROOT, asset.file)), mime: asset.mime };
  } catch {
    return null;
  }
}
