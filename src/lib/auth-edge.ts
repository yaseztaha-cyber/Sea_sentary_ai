export const SESSION_COOKIE = "sentry_session";

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function validSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp <= Date.now()) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`v1:${expStr}`);
  try {
    return await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig) as unknown as BufferSource, data);
  } catch {
    return false;
  }
}
