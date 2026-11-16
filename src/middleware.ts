import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, validSession } from "@/lib/auth-edge";

const PROTECTED_API =
  /^\/(api\/incidents|api\/settings|api\/zones|api\/events|api\/system|api\/telemetry|api\/audio|api\/push|api\/notifications|api\/telephony|api\/phone|api\/telegram)/;
const PUBLIC_API = /^\/(api\/auth|api\/health|api\/phone\/webhook|api\/phone\/twiml)/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_API.test(pathname)) return NextResponse.next();
  if (!PROTECTED_API.test(pathname) && !pathname.startsWith("/app")) return NextResponse.next();

  const configured = !!(process.env.OPERATOR_PASSWORD || process.env.OPERATOR_PASSWORD_HASH) && (process.env.SESSION_SECRET?.length ?? 0) >= 24;
  if (!configured) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Operator access is not configured" }, { status: 503 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=not-configured";
    return NextResponse.redirect(url);
  }

  // Same-origin mutation check adds CSRF defence on top of SameSite=Strict.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.get("host")) {
          return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
      }
    }
  }

  const ok = await validSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + (req.nextUrl.search || ""))}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/app/:path*",
    "/api/incidents/:path*",
    "/api/settings/:path*",
    "/api/zones/:path*",
    "/api/events",
    "/api/system",
    "/api/telemetry",
    "/api/audio/:path*",
    "/api/push/:path*",
    "/api/notifications/:path*",
    "/api/telephony/:path*",
    "/api/phone/:path*",
    "/api/telegram/:path*",
  ],
};
