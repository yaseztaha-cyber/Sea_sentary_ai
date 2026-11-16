"use client";

import Link from "next/link";
import { useEngine, useSnapshot } from "./SentryProvider";
import { Btn, Mono, RiskBadge, fmtTime } from "./ui";

export function CriticalBanner() {
  const engine = useEngine();
  const snap = useSnapshot();
  const open = snap.critical.filter((c) => c.status === "NEW" || c.status === "UNDER_REVIEW" || c.status === "ACKNOWLEDGED");
  if (!open.length) return null;
  const [first, ...rest] = open;
  const a = snap.audio;
  const audioProblem =
    a.state === "error" || a.state === "unsupported" || a.state === "locked"
      ? a.lastError ?? a.message
      : a.state === "muted"
        ? "Critical alert audio is disabled or muted"
        : a.lastPlayback?.incidentId === first.id
          ? a.lastPlayback?.error
          : null;
  const acked = first.status === "ACKNOWLEDGED";
  return (
    <section aria-live="assertive" className={`rounded-[7px] border-2 ${acked ? "border-amber/45 bg-amber/5" : "critical-pulse border-coral bg-coral/10"} p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge risk="CRITICAL" />
            <Mono className="text-moon">{first.ref}</Mono>
            {first.isTest && <span className="rounded border border-amber/50 px-1.5 py-[1px] text-[0.62rem] font-semibold tracking-[0.08em] text-amber">TEST — NOT A REAL DETECTION</span>}
            <span className={`rounded border px-1.5 py-[1px] text-[0.62rem] font-semibold tracking-[0.08em] ${acked ? "border-amber/50 text-amber" : "border-coral/60 text-coral"}`}>{acked ? "ACKNOWLEDGED · REVIEW REQUIRED" : first.status.replace("_", " ")}</span>
          </div>
          <p className="mt-1.5 font-display text-[1.05rem] text-moon">Possible swimmer distress — lifeguard assistance required</p>
          <p className="mt-1 text-[0.8rem] text-glass">
            {first.zoneName ? `Zone ${first.zoneName}` : "Unzoned monitored area"} · {fmtTime(first.createdAt)} · track {first.trackId ? `#${first.trackId}` : "not linked"} · {first.title}
          </p>
          {audioProblem && (
            <p className="mt-1.5 rounded border border-coral/50 bg-abyss/50 px-2 py-1 text-[0.72rem] font-semibold text-coral">
              AUDIBLE ALERT FAILED / NOT PLAYED — {audioProblem}. The visual incident is still active.
            </p>
          )}
          {a.active && <p className="mt-1 font-mono text-[0.66rem] text-amber">Audio: {a.active.phase} playing for {a.active.ref}{a.queued ? ` · ${a.queued} queued` : ""}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!acked && <Btn tone="danger" onClick={() => void engine.acknowledgeIncident(first.id)}>Acknowledge (silence siren)</Btn>}
          <Link href={`/app/incidents?id=${first.id}`} className="inline-flex h-9 items-center rounded-[5px] border border-line bg-depth/50 px-3 text-[0.78rem] font-medium text-moon hover:border-teal">Review evidence</Link>
        </div>
      </div>
      {rest.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-coral/25 pt-2">
          {rest.slice(0, 3).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.72rem]">
              <span className="text-glass"><Mono>{c.ref}</Mono> · {c.zoneName ?? "unzoned"} · {c.status}</span>
              <span className="flex gap-2">
                {c.status !== "ACKNOWLEDGED" && <button className="text-coral hover:underline" onClick={() => void engine.acknowledgeIncident(c.id)}>Acknowledge</button>}
                <Link className="text-mint hover:underline" href={`/app/incidents?id=${c.id}`}>Open</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[0.64rem] leading-relaxed text-mist">
        Acknowledgment silences the active siren but does not resolve the incident. The incident stays open until an operator resolves it. This is suspected distress, not a confirmed drowning.
      </p>
    </section>
  );
}
