"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { useEngine, useSnapshot } from "./SentryProvider";
import { Mono, monitoringStatus, Pill } from "./ui";

const I = {
  monitor: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  incident: <path d="M12 3 2.5 20h19L12 3zM12 10v4M12 17.2v.1" />,
  camera: <path d="M3 8h4l2-3h6l2 3h4v11H3zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />,
  settings: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
};

const NAV = [
  { href: "/app", label: "Monitoring", icon: I.monitor, match: (p: string) => p === "/app" },
  { href: "/app/incidents", label: "Incidents", icon: I.incident, match: (p: string) => p.startsWith("/app/incidents") },
  { href: "/app/camera", label: "Camera & AI", icon: I.camera, match: (p: string) => p.startsWith("/app/camera") || p.startsWith("/app/ai") },
  { href: "/app/settings", label: "Settings", icon: I.settings, match: (p: string) => p.startsWith("/app/settings") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const snap = useSnapshot();
  const engine = useEngine();
  const st = monitoringStatus(snap);
  const open = snap.notices.length;

  return (
    <div className="flex h-dvh flex-col bg-abyss text-moon md:flex-row">
      <nav className="order-2 flex shrink-0 items-center justify-around border-t border-line bg-ocean md:order-1 md:w-[78px] md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:py-4" aria-label="Primary">
        <Link href="/" className="hidden pb-5 pt-1 md:block" aria-label="Sea Sentry AI — public site" title="Public site">
          <LogoMark size={34} />
        </Link>
        {NAV.map((n) => {
          const active = n.match(path);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`group relative flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[0.62rem] font-medium tracking-wide transition-colors md:py-3 ${active ? "text-mint" : "text-mist hover:text-moon"}`}>
              {active && <span className="absolute left-0 top-2 hidden h-[calc(100%-1rem)] w-[2px] rounded bg-mint md:block" />}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{n.icon}</svg>
              <span className="text-center leading-tight">{n.label}</span>
              {n.href === "/app/incidents" && open > 0 && <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-coral md:right-4" />}
            </Link>
          );
        })}
      </nav>

      <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col md:order-2">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-ocean/80 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-[0.8rem] tracking-[0.2em] text-moon">SEA SENTRY <span className="text-mint">AI</span></span>
            <span className="hidden text-line sm:inline">/</span>
            <Pill tone={st.tone} dot>{st.label}</Pill>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-[0.72rem] text-mist sm:flex" title="Server event stream (Server-Sent Events)">
              <span className={`h-1.5 w-1.5 rounded-full ${snap.link.sse === "open" ? "bg-mint" : snap.link.sse === "connecting" ? "bg-amber" : "bg-coral"}`} />
              {snap.link.sse === "open" ? "Events connected" : snap.link.sse === "connecting" ? "Events reconnecting" : "Events offline"}
            </span>
            <Mono className="hidden text-mist md:inline">V1 · camera-based</Mono>
          </div>
        </header>
        <main className="app-scroll min-h-0 flex-1 overflow-auto">{children}</main>
      </div>

      {/* in-app notifications — each one is tied to a persisted incident, or is a real failure message */}
      <div className="pointer-events-none fixed right-4 top-14 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {snap.notices.slice(0, 4).map((n) => (
          <div key={n.id} className={`pointer-events-auto rounded-[7px] border bg-ocean p-3 shadow-[0_12px_32px_rgba(0,0,0,0.5)] ${n.tone === "alert" ? "border-coral/60" : n.tone === "warn" ? "border-amber/50" : n.tone === "error" ? "border-coral/40" : "border-line"}`}>
            <div className="flex items-start justify-between gap-3">
              <p className={`text-[0.82rem] font-semibold ${n.tone === "alert" || n.tone === "error" ? "text-coral" : n.tone === "warn" ? "text-amber" : "text-moon"}`}>{n.title}</p>
              <button onClick={() => engine.dismissNotice(n.id)} className="text-mist hover:text-moon" aria-label="Dismiss"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>
            </div>
            <p className="mt-1 text-[0.76rem] leading-relaxed text-mist">{n.body}</p>
            {n.incidentId && (
              <Link href={`/app/incidents?id=${n.incidentId}`} onClick={() => engine.dismissNotice(n.id)} className="mt-2 inline-block text-[0.76rem] font-medium text-mint hover:underline">
                Open in Incident Desk <span className="arrow ml-1" aria-hidden="true" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
