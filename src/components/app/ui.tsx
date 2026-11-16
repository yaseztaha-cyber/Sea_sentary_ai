"use client";

import type { ReactNode } from "react";
import type { EngineSnapshot } from "@/lib/engine/runtime";
import { RISK_LABEL, type RiskLevel } from "@/lib/settings";

export type Tone = "ok" | "warn" | "alert" | "idle" | "info";

const toneCls: Record<Tone, string> = {
  ok: "text-mint border-mint/30 bg-mint/10",
  warn: "text-amber border-amber/30 bg-amber/10",
  alert: "text-coral border-coral/40 bg-coral/10",
  idle: "text-mist border-line bg-depth/40",
  info: "text-glass border-glass/25 bg-glass/10",
};

export function Pill({ tone = "idle", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-[3px] text-[0.68rem] font-medium uppercase tracking-[0.1em] ${toneCls[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full bg-current ${tone === "ok" || tone === "alert" ? "pulse-dot" : ""}`} />}
      {children}
    </span>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[7px] border border-line bg-ocean ${className}`}>
      {(title || action) && (
        <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-glass">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.78rem] ${className}`}>{children}</span>;
}

export function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-[7px] last:border-0">
      <dt className="text-[0.8rem] text-mist">{k}</dt>
      <dd className={`text-right font-mono text-[0.78rem] ${tone === "alert" ? "text-coral" : tone === "warn" ? "text-amber" : tone === "ok" ? "text-mint" : "text-moon"}`}>{v}</dd>
    </div>
  );
}

export function Btn({ children, onClick, tone = "default", disabled, active, title, type = "button", className = "" }: { children: ReactNode; onClick?: () => void; tone?: "default" | "primary" | "danger" | "quiet"; disabled?: boolean; active?: boolean; title?: string; type?: "button" | "submit"; className?: string }) {
  const base = "inline-flex h-9 items-center justify-center gap-2 rounded-[5px] border px-3 text-[0.78rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const cls =
    tone === "primary"
      ? "border-mint bg-mint text-abyss hover:bg-glass"
      : tone === "danger"
        ? "border-coral/50 text-coral hover:bg-coral/10"
        : active
          ? "border-mint/60 bg-mint/15 text-mint"
          : "border-line bg-depth/50 text-moon hover:border-teal hover:bg-depth";
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`${base} ${cls} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-[0.85rem] text-moon">{label}</span>
        {hint && <span className="block text-[0.75rem] text-mist">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? "border-mint bg-mint/30" : "border-line bg-depth"}`}>
        <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full transition-all ${checked ? "left-[18px] bg-mint" : "left-[2px] bg-mist"}`} />
      </button>
    </label>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.85rem] text-moon">{label}</span>
        <Mono className="text-mint">{format ? format(value) : value}</Mono>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-line accent-[#79DCC4]" />
      {hint && <p className="mt-1 text-[0.72rem] text-mist">{hint}</p>}
    </div>
  );
}

export function Select({ label, value, onChange, options, disabled, hint }: { label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean; hint?: string }) {
  return (
    <label className="block py-1">
      {label && <span className="mb-1 block text-[0.75rem] text-mist">{label}</span>}
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon outline-none focus:border-mint disabled:opacity-40">
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ocean">
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="mt-1 block text-[0.72rem] text-mist">{hint}</span>}
    </label>
  );
}

export const EXPERIMENTAL = "EXPERIMENTAL — HUMAN REVIEW REQUIRED";

export function ExperimentalTag() {
  return <span className="inline-flex items-center rounded-[4px] border border-amber/40 bg-amber/10 px-2 py-[3px] text-[0.64rem] font-semibold tracking-[0.12em] text-amber">{EXPERIMENTAL}</span>;
}

/** One honest status line combining camera + AI state. A frozen image is never labelled LIVE. */
export function monitoringStatus(s: EngineSnapshot): { label: string; tone: Tone } {
  const c = s.camera;
  if (c.state === "disconnected") return { label: "Disconnected", tone: "idle" };
  if (c.state === "connecting") return { label: "Connecting", tone: "info" };
  if (c.state === "error") return { label: "Error", tone: "alert" };
  if (c.state === "degraded" || !c.live) return { label: "Degraded", tone: "warn" };
  if (s.ai.model === "unavailable") return { label: "AI unavailable", tone: "warn" };
  if (!s.ai.enabled) return { label: "Connected · AI off", tone: "ok" };
  switch (s.ai.state) {
    case "loading":
      return { label: "AI loading", tone: "info" };
    case "tracking":
      return { label: "Active tracking", tone: "ok" };
    case "processing":
      return { label: "AI processing", tone: "ok" };
    case "no_detections":
      return { label: "No detections", tone: "ok" };
    default:
      return { label: "Connected", tone: "ok" };
  }
}

export const fmtTime = (iso: string | Date) => new Date(iso).toLocaleTimeString([], { hour12: false });
export const fmtDateTime = (iso: string | Date) => new Date(iso).toLocaleString([], { hour12: false });

export const SEVERITY_LABEL: Record<string, string> = {
  WATCH: "Watch",
  SUSPECTED: "Suspected swimmer distress",
  CRITICAL: "Critical suspected distress",
  LEVEL_2: "Level 2 · Unusual",
  LEVEL_3: "Level 3 · Potential distress",
};
export const STATUS_TONE: Record<string, Tone> = { NEW: "alert", ACKNOWLEDGED: "warn", UNDER_REVIEW: "info", RESOLVED: "ok", FALSE_ALARM: "idle" };
export const statusLabel = (s: string) => s.replace("_", " ");

const RISK_STYLE: Record<RiskLevel, { glyph: string; cls: string }> = {
  NORMAL: { glyph: "●", cls: "border-line bg-depth/40 text-mist" },
  WATCH: { glyph: "▲", cls: "border-glass/35 bg-glass/10 text-glass" },
  SUSPECTED: { glyph: "◆", cls: "border-amber/45 bg-amber/10 text-amber" },
  CRITICAL: { glyph: "■", cls: "border-coral/60 bg-coral/15 text-coral" },
  UNCERTAIN: { glyph: "?", cls: "border-glass/35 bg-depth/40 text-glass" },
  INSUFFICIENT_VISIBILITY: { glyph: "◌", cls: "border-line bg-depth/40 text-mist" },
  OPERATOR_ACKNOWLEDGED: { glyph: "✓", cls: "border-mint/40 bg-mint/10 text-mint" },
};

/** Status is never communicated by colour alone: every badge carries a glyph and a readable label. */
export function RiskBadge({ risk, short = false, className = "" }: { risk: RiskLevel; short?: boolean; className?: string }) {
  const s = RISK_STYLE[risk];
  const label = short ? (risk === "CRITICAL" ? "CRITICAL" : risk === "SUSPECTED" ? "SUSPECTED" : RISK_LABEL[risk].toUpperCase()) : RISK_LABEL[risk].toUpperCase();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-[2px] text-[0.64rem] font-semibold tracking-[0.08em] ${s.cls} ${className}`}>
      <span aria-hidden="true">{s.glyph}</span>
      {label}
    </span>
  );
}
