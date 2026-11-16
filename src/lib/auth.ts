import crypto from "node:crypto";

export const SESSION_COOKIE = "sentry_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function authConfigured() {
  return !!(process.env.OPERATOR_PASSWORD || process.env.OPERATOR_PASSWORD_HASH);
}

function passwordMatches(input: string): boolean {
  const hash = process.env.OPERATOR_PASSWORD_HASH;
  if (hash) {
    const [scheme, salt, digest] = hash.split("$");
    if (scheme !== "scrypt" || !salt || !digest) return false;
    const got = crypto.scryptSync(input, salt, 32).toString("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(digest, "hex"));
    } catch {
      return false;
    }
  }
  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(input: string): boolean {
  return authConfigured() && passwordMatches(input);
}

export function createSessionToken(now = Date.now()): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) return null;
  const exp = now + SESSION_TTL_MS;
  const sig = crypto.createHmac("sha256", secret).update(`v1:${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${digest}`;
}
