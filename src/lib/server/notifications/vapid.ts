import fs from "node:fs/promises";
import path from "node:path";
import { generateVAPIDKeys, setVapidDetails } from "web-push";

const ROOT = path.join(process.cwd(), "data", "web-push");
const FILE = path.join(ROOT, "vapid.json");

export type VapidConfig = { publicKey: string; privateKey: string; subject: string; source: "env" | "generated" | "persisted" };

let cached: VapidConfig | null | undefined;

/**
 * VAPID keys are server-side only. Environment variables take precedence. For
 * local-first operation, a key pair is generated once and persisted in the
 * local data directory so existing subscriptions survive a restart. In a
 * stateless/serverless deployment, set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 */
export async function getVapid(): Promise<VapidConfig | null> {
  if (cached !== undefined) return cached;
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:operator@sea-sentry.local";
  if (envPublic && envPrivate) {
    cached = { publicKey: envPublic, privateKey: envPrivate, subject, source: "env" };
    return cached;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { publicKey: string; privateKey: string };
    if (parsed.publicKey && parsed.privateKey) {
      cached = { publicKey: parsed.publicKey, privateKey: parsed.privateKey, subject, source: "persisted" };
      return cached;
    }
  } catch {
    /* first run */
  }
  try {
    const keys = generateVAPIDKeys();
    await fs.mkdir(ROOT, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ ...keys, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    cached = { ...keys, subject, source: "generated" };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export async function configureVapid(): Promise<VapidConfig | null> {
  const v = await getVapid();
  if (!v) return null;
  setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return v;}
