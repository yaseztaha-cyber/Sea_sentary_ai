"use client";

import { useState } from "react";
import { useSnapshot } from "./SentryProvider";
import { ExperimentalTag, Mono, Panel, RiskBadge } from "./ui";
import { RISK_LABEL } from "@/lib/settings";

export function DistressPanel() {
  const { distress, heatmap } = useSnapshot();
  const [open, setOpen] = useState<number | null>(null);
  const list = distress.assessments.filter((a) => a.level !== "NORMAL").slice(0, 8);
  const normal = distress.counts.NORMAL;
  return (
    <Panel
      title="Swimmer distress assessment"
      action={<ExperimentalTag />}
    >
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Mono className="text-mist">{distress.counts.CRITICAL} critical · {distress.counts.SUSPECTED} suspected · {distress.counts.WATCH} watch · {normal} normal</Mono>
        </div>
        {list.length === 0 ? (
          <div className="rounded-[5px] border border-dashed border-line bg-abyss/40 p-3">
            <p className="text-[0.8rem] text-moon">No concerning behavioral pattern right now.</p>
            <p className="mt-1 text-[0.72rem] leading-relaxed text-mist">
              {distress.assessments.length
                ? `${distress.assessments.length} tracked person(s) are being assessed over time. Normal swimming, floating and a single still period do not create an incident.`
                : "Start AI and keep people in view. The temporal engine requires a track history before it can assess anything."}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {list.map((a) => {
              const expanded = open === a.trackId;
              const indicators = a.indicators.filter((i) => i.available && i.strength >= 0.25);
              return (
                <li key={a.trackId} className={`rounded-[5px] border ${a.level === "CRITICAL" ? "border-coral/50 bg-coral/5" : a.level === "SUSPECTED" ? "border-amber/35 bg-amber/5" : "border-line bg-depth/30"}`}>
                  <button className="flex w-full items-start justify-between gap-2 p-2 text-left" onClick={() => setOpen(expanded ? null : a.trackId)} aria-expanded={expanded}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Mono className="text-moon">#{a.trackId}</Mono>
                        <RiskBadge risk={a.level} short />
                        {!a.visible && <span className="rounded border border-line px-1 py-[1px] font-mono text-[0.6rem] text-mist">NOT VISIBLE</span>}
                      </span>
                      <span className="mt-1 block truncate text-[0.72rem] text-mist">
                        {a.zone ?? "unzoned"} · {a.persistentSeconds.toFixed(0)}s pattern · {a.samples} samples
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[0.8rem] text-moon">{a.score.toFixed(2)}</span>
                      <span className="block font-mono text-[0.58rem] text-mist">heuristic</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="space-y-2 border-t border-line/60 p-2">
                      <p className="text-[0.7rem] leading-relaxed text-mist">
                        {a.level === "CRITICAL" ? "Critical screening result. " : a.level === "SUSPECTED" ? "Suspected screening result. " : "Watch only — no siren. "}
                        This is not a confirmed drowning; a trained operator must verify.
                      </p>
                      <ul className="space-y-1">
                        {indicators.length === 0 && <li className="text-[0.7rem] text-mist">No strong indicator.</li>}
                        {indicators.map((i) => (
                          <li key={i.key} className="text-[0.7rem] text-moon/90">
                            <span className="font-mono text-[0.66rem] text-mist">{Math.round(i.strength * 100)}%</span> {i.label}
                            <span className="block pl-6 text-[0.66rem] text-mist">{i.value} {i.unit} · {i.seconds}s · {i.note}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="font-mono text-[0.62rem] leading-relaxed text-mist">
                        anchor {a.anchor.x.toFixed(2)},{a.anchor.y.toFixed(2)} · {a.windowSeconds.toFixed(0)}s window · score kind {a.scoreKind} · confidence {a.modelConfidence === null ? "not available" : a.modelConfidence}
                      </p>
                      <p className="text-[0.64rem] leading-relaxed text-amber/90">{a.limitations[0]}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[0.66rem] leading-relaxed text-mist">
          Thresholds are experimental engineering defaults, not validated drowning-detection criteria. Heatmap mode: {heatmap.mode}. No facial recognition is used.
        </p>
      </div>
    </Panel>
  );
}
