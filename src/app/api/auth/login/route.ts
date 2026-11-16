import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authConfigured, cookieOptions, createSessionToken, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const attempts = new Map<string, { count: number; reset: number }>();

export async function POST(req: NextRequest) {
  if (!authConfigured()) return NextResponse.json({ error: "Operator access is not configured" }, { status: 503 });
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24) {
    return NextResponse.json({ error: "SESSION_SECRET is missing or too short" }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.reset > now && a.count >= 6) {
    return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!verifyPassword(password)) {
    attempts.set(ip, { count: a && a.reset > now ? a.count + 1 : 1, reset: a && a.reset > now ? a.reset : now + 10 * 60 * 1000 });
    return NextResponse.json({ error: "Invalid operator password" }, { status: 401 });
  }
  attempts.delete(ip);
  const token = createSessionToken();
  if (!token) return NextResponse.json({ error: "Session secret is not configured" }, { status: 503 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
