"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useEngine, useSnapshot } from "@/components/app/SentryProvider";
import { VideoStage, type Layers } from "@/components/app/VideoStage";
import { Inspector } from "@/components/app/Inspector";
import { ZonePanel, type ZoneDraft } from "@/components/app/ZonePanel";
import { HeatmapPanel } from "@/components/app/HeatmapPanel";
import { DistressPanel } from "@/components/app/DistressPanel";
import { AudioPanel } from "@/components/app/AudioPanel";
import { CriticalBanner } from "@/components/app/CriticalBanner";
import { Btn, ExperimentalTag, fmtTime, Mono, Panel, Pill, SEVERITY_LABEL, STATUS_TONE, statusLabel } from "@/components/app/ui";
import { useIncidents } from "@/components/app/useIncidents";
import { ZONE_COLORS } from "@/lib/engine/draw";

const tone = { ok: "text-mint", warn: "text-amber", alert: "text-coral", undefined: "text-mist" } as const;

export default function MonitoringPage() {
  const engine = useEngine();
  const snap = useSnapshot();
  const stageRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Layers>({ boxes: true, trails: true, zones: true, heat: false });
  const [tab, setTab] = useState<"inspector" | "zones">("inspector");
  const [draft, setDraft] = useState<ZoneDraft>({ active: false, points: [], name: "", type: "SWIMMING" });
  const [busy, setBusy] = useState(false);
  const { rows, error } = useIncidents("NEW,ACKNOWLEDGED,UNDER_REVIEW");

  const live = snap.camera.live;
  const raw = !layers.boxes && !layers.trails && !layers.heat && !layers.zones;
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const perf = snap.perf;

  const snapshot = () => {
    const c = engine.drawFrameWithOverlay(layers, 1920);
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/jpeg", 0.9);
    a.download = `sea-sentry-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    a.click();
  };

  return (
    <div className="grid min-h-full grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <CriticalBanner />

        <Panel>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Btn active={raw} onClick={() => setLayers({ boxes: false, trails: false, zones: false, heat: false })} title="Show the raw camera image only">Raw camera</Btn>
            <Btn active={layers.boxes} onClick={() => toggle("boxes")} title="Detection boxes, anonymous track IDs and risk state">AI annotated</Btn>
            <Btn active={layers.trails} onClick={() => toggle("trails")}>Tracking trails</Btn>
            <Btn active={layers.heat} onClick={() => toggle("heat")}>Heatmap overlay</Btn>
            <Btn active={layers.zones} onClick={() => toggle("zones")}>Zones</Btn>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <Btn tone={snap.ai.enabled ? "default" : "primary"} active={snap.ai.enabled} onClick={() => void engine.setAi(!snap.ai.enabled)}>
              {snap.ai.model === "loading" ? "Loading model…" : snap.ai.enabled ? "AI on" : "Run AI"}
            </Btn>
            <div className="ml-auto flex gap-2">
              <Btn onClick={snapshot} disabled={!live}>Snapshot</Btn>
              <Btn onClick={() => stageRef.current?.requestFullscreen?.()}>Fullscreen</Btn>
            </div>
          </div>
          <VideoStage
            layers={layers}
            stageRef={stageRef}
            draw={{ active: draft.active, draft: draft.points, color: ZONE_COLORS[draft.type], onAdd: (p) => setDraft((d) => ({ ...d, points: [...d.points, p] })), onClose: () => setTab("zones") }}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 font-mono text-[0.66rem] text-mist">
            <span className={live ? "text-mint" : ""}>capture {live ? `${snap.camera.captureFps.toFixed(1)} fps` : "—"}</span>
            <span>detect {snap.ai.enabled ? `${perf.detectorRate.toFixed(2)}/s` : "off"}</span>
            <span>track {snap.ai.enabled ? `${perf.trackingRate.toFixed(2)}/s` : "off"}</span>
            <span>latency {snap.ai.inferenceFrames ? `${perf.avgLatencyMs.toFixed(0)} ms avg` : "—"}</span>
            <span>frame age {snap.ai.inferenceFrames ? `${perf.queueDelayMs.toFixed(0)} ms` : "—"}</span>
            <span>provider {snap.ai.model === "ready" ? snap.ai.backend : "—"}</span>
            <span className={perf.alertLatencyMs !== null ? "text-mint" : ""}>alert {perf.alertLatencyMs !== null ? `${perf.alertLatencyMs} ms` : "—"}</span>
            <span>CPU {perf.serverCpuPercent !== null ? `${perf.serverCpuPercent.toFixed(1)}%` : "—"}</span>
            <span>RAM {perf.systemUsedMb !== null ? `${perf.systemUsedMb}/${perf.systemTotalMb} MB` : "—"}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.75rem] text-mist">
            <span>{snap.ai.state === "no_detections" && live ? "AI is running — no persons detected in the current frame." : snap.ai.model === "unavailable" ? "AI unavailable — raw video continues." : "Detection, tracking and heatmap run on actual camera frames only."}</span>
            <ExperimentalTag />
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Incident queue"
            action={
              <div className="flex gap-1.5">
                <Btn
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await engine.raiseTestObservation(3);
                    setBusy(false);
                  }}
                  title="Creates a clearly labelled TEST suspected-distress incident; no siren"
                  className="!h-8 !px-2 !text-[0.7rem]"
                >
                  TEST × 3
                </Btn>
                <Btn
                  disabled={busy}
                  tone="danger"
                  onClick={async () => {
                    setBusy(true);
                    await engine.raiseTestObservation(4);
                    setBusy(false);
                  }}
                  title="Creates a clearly labelled TEST critical incident and exercises the siren + voice path"
                  className="!h-8 !px-2 !text-[0.7rem]"
                >
                  TEST × 4 critical
                </Btn>
              </div>
            }
          >
            <ul className="max-h-72 divide-y divide-line/60 overflow-auto app-scroll">
              {error && <li className="p-4 text-[0.8rem] text-coral">Could not load incidents: {error}</li>}
              {!error && rows.length === 0 && <li className="p-4 text-[0.82rem] text-mist">No open incidents. Detection alone never creates an emergency.</li>}
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/incidents?id=${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-depth/50">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><Mono className="text-moon">{r.ref}</Mono>{r.isTest && <Pill tone="warn">Test</Pill>}</span>
                      <span className={`mt-0.5 block truncate text-[0.78rem] ${r.severity === "CRITICAL" ? "text-coral" : "text-mist"}`}>{SEVERITY_LABEL[r.severity] ?? r.severity} · {r.trackId ? `track #${r.trackId} · ` : ""}{fmtTime(r.createdAt)}</span>
                    </span>
                    <Pill tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Event timeline">
            <ul className="app-scroll max-h-72 overflow-auto">
              {snap.events.length === 0 && <li className="p-4 text-[0.82rem] text-mist">No events yet.</li>}
              {snap.events.slice(0, 60).map((e) => (
                <li key={e.id} className="flex gap-3 border-b border-line/50 px-4 py-2 text-[0.78rem] last:border-0">
                  <Mono className="shrink-0 text-mist">{fmtTime(e.at)}</Mono>
                  <span className={tone[(e.tone ?? "undefined") as keyof typeof tone] === tone.undefined ? "text-moon" : tone[e.tone as keyof typeof tone]}>{e.message}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <aside className="min-w-0 space-y-4">
        <DistressPanel />
        <HeatmapPanel overlay={layers.heat} onToggleOverlay={() => toggle("heat")} />
        <AudioPanel />
        <Panel>
          <div className="flex border-b border-line" role="tablist">
            {(["inspector", "zones"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 px-3 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.14em] transition-colors ${tab === t ? "border-b-2 border-mint text-mint" : "border-b-2 border-transparent text-mist hover:text-moon"}`}>
                {t === "inspector" ? "Inspector" : "Zones"}
              </button>
            ))}
          </div>
          {tab === "inspector" ? <Inspector /> : <ZonePanel draft={draft} setDraft={setDraft} />}
        </Panel>
      </aside>
    </div>
  );
}
