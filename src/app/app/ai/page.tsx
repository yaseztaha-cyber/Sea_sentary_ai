"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine, useSettingsUpdater, useSnapshot } from "@/components/app/SentryProvider";
import { VideoStage } from "@/components/app/VideoStage";
import { CameraAiTabs } from "@/components/app/CameraAiTabs";
import { Btn, ExperimentalTag, fmtTime, Mono, Panel, Pill, RiskBadge, Row, Slider, Toggle } from "@/components/app/ui";
import { HEAT_RAMP } from "@/lib/engine/heatmap";
import type { HeatmapMode } from "@/lib/settings";

const WINDOWS: { s: 60 | 300 | 900 | 1800; l: string }[] = [
  { s: 60, l: "1 min" },
  { s: 300, l: "5 min" },
  { s: 900, l: "15 min" },
  { s: 1800, l: "30 min" },
];

const MODES: { id: HeatmapMode; l: string; note: string }[] = [
  { id: "occupancy", l: "Occupancy", note: "Where tracked people spend the most time." },
  { id: "movement", l: "Movement", note: "Accumulated movement paths and displacement-weighted activity." },
  { id: "dwell", l: "Dwell", note: "Areas where someone remains nearly stationary for longer." },
];

export default function AiPage() {
  const engine = useEngine();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const stageRef = useRef<HTMLDivElement>(null);
  const [compare, setCompare] = useState(true);
  const [stats, setStats] = useState({ peak: 0, peakDwell: 0, buckets: 0, samples: 0, cells: 0 });
  const h = snap.settings.heatmap;

  useEffect(() => {
    const id = setInterval(() => {
      const r = engine.pipeline.heatmap.compute(engine.settings.heatmap.windowSeconds, performance.now() / 1000, engine.settings.heatmap.mode, engine.settings.heatmap.decayHalfLifeSeconds);
      setStats({ peak: r.peak, peakDwell: r.peakDwellSeconds, buckets: r.buckets, samples: engine.pipeline.heatmap.samples, cells: r.activeCells });
    }, 1000);
    return () => clearInterval(id);
  }, [engine]);

  const empty = stats.buckets === 0 || stats.peak <= 0;
  const mode = MODES.find((m) => m.id === h.mode)!;
  const gradient = `linear-gradient(90deg, ${HEAT_RAMP[h.mode].map(([p, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${Math.round(p * 100)}%`).join(", ")})`;

  return (
    <div>
      <CameraAiTabs />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title="Live activity heatmap"
            action={
              <div className="flex items-center gap-2">
                {snap.heatmap.live ? <Pill tone="ok" dot>Live</Pill> : snap.heatmap.samples > 0 ? <Pill tone="warn">Historical</Pill> : <Pill tone="idle">Empty</Pill>}
                <Btn active={compare} onClick={() => setCompare((c) => !c)}>Compare with raw</Btn>
                <Btn onClick={() => stageRef.current?.requestFullscreen?.()}>Fullscreen</Btn>
              </div>
            }
          >
            <VideoStage layers={{ boxes: false, trails: false, zones: false, heat: true }} stageRef={stageRef} compare={compare} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.75rem] text-mist">
              <span>
                {!snap.ai.enabled ? "Start AI to build the heatmap from real tracked person anchors." : empty ? "Empty — no tracked person positions inside this time window yet." : `Built from ${stats.samples.toLocaleString()} tracked positions; ${stats.cells} active cells.`}
              </span>
              <Mono>camera-image density · not thermal imaging</Mono>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Recent distress observations" action={<ExperimentalTag />}>
              <ul className="app-scroll max-h-80 divide-y divide-line/60 overflow-auto">
                {snap.observations.length === 0 && <li className="p-4 text-[0.82rem] text-mist">No observations. NORMAL is the default state and is not logged.</li>}
                {snap.observations.slice(0, 20).map((o, i) => (
                  <li key={i} className="space-y-1 p-3 text-[0.8rem]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <RiskBadge risk={o.riskLevel ?? (o.level === 4 ? "CRITICAL" : o.level === 3 ? "SUSPECTED" : "WATCH")} short />
                        <span className="text-moon">{o.kind}</span>
                      </span>
                      <Mono className="text-mist">{fmtTime(o.at)}</Mono>
                    </div>
                    <p className="text-mist">{o.summary}</p>
                    {o.assessment && <p className="font-mono text-[0.64rem] text-mist">heuristic {o.assessment.score.toFixed(2)} · pattern {o.assessment.persistentSeconds.toFixed(1)}s · zone {o.assessment.zone ?? "unzoned"} · confidence not available</p>}
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Current assessments">
              <ul className="app-scroll max-h-80 divide-y divide-line/60 overflow-auto">
                {snap.distress.assessments.filter((a) => a.level !== "NORMAL").length === 0 && <li className="p-4 text-[0.82rem] text-mist">No person currently above NORMAL.</li>}
                {snap.distress.assessments.filter((a) => a.level !== "NORMAL").map((a) => (
                  <li key={a.trackId} className="flex items-center justify-between gap-3 p-3 text-[0.78rem]">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><Mono>#{a.trackId}</Mono><RiskBadge risk={a.level} short /></span>
                      <span className="mt-0.5 block truncate text-mist">{a.zone ?? "unzoned"} · {a.persistentSeconds.toFixed(0)}s · {a.visible ? "visible" : "not visible"}</span>
                    </span>
                    <Mono className="text-moon">{a.score.toFixed(2)}</Mono>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <aside className="space-y-4">
          <Panel title="Heatmap controls">
            <div className="p-4">
              <p className="mb-1.5 text-[0.72rem] uppercase tracking-[0.12em] text-glass">Mode</p>
              <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Heatmap mode">
                {MODES.map((m) => (
                  <Btn key={m.id} active={h.mode === m.id} onClick={() => update((x) => (x.heatmap.mode = m.id))} className="!px-1 !text-[0.68rem]">{m.l}</Btn>
                ))}
              </div>
              <p className="mt-2 text-[0.74rem] leading-relaxed text-mist">{mode.note}</p>
              <div className="mt-2 h-2 w-full rounded-full" style={{ background: gradient }} aria-hidden="true" />
              <div className="mt-1 flex justify-between font-mono text-[0.6rem] text-mist"><span>low</span><span>high</span></div>

              <p className="mb-1 mt-3 text-[0.75rem] text-mist">Time window</p>
              <div className="grid grid-cols-4 gap-1.5">
                {WINDOWS.map((w) => (
                  <Btn key={w.s} active={h.windowSeconds === w.s} onClick={() => update((x) => (x.heatmap.windowSeconds = w.s))} className="!px-1 !text-[0.68rem]">{w.l}</Btn>
                ))}
              </div>
              <Slider label="Intensity" value={h.intensity} min={0.4} max={3} step={0.1} onChange={(v) => update((x) => (x.heatmap.intensity = v))} format={(v) => v.toFixed(1)} />
              <Slider label="Opacity" value={h.opacity} min={0.1} max={1} step={0.05} onChange={(v) => update((x) => (x.heatmap.opacity = v))} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Decay half-life" value={h.decayHalfLifeSeconds} min={20} max={900} step={10} onChange={(v) => update((x) => (x.heatmap.decayHalfLifeSeconds = v))} format={(v) => `${v}s`} />
              <Toggle checked={h.monitoredOnly} onChange={(v) => update((x) => (x.heatmap.monitoredOnly = v))} label="Monitored area only" hint="Uses enabled zones; IGNORE zones are subtracted." />
              <Btn tone="danger" onClick={() => engine.resetHeatmap()} className="mt-2 w-full">Reset heatmap</Btn>
            </div>
          </Panel>

          <Panel title="Measured">
            <dl className="p-4">
              <Row k="Tracked positions (total)" v={stats.samples.toLocaleString()} />
              <Row k="Active grid cells" v={stats.cells} />
              <Row k="Seconds with data in window" v={stats.buckets} />
              <Row k="Peak occupancy" v={empty ? "—" : stats.peak.toFixed(2)} />
              <Row k="Peak dwell in one cell" v={empty ? "—" : `${stats.peakDwell.toFixed(1)} s`} />
              <Row k="Mode" v={h.mode} />
              <Row k="Current source" v={snap.heatmap.live ? "live tracks" : "historical / none"} />
              <Row k="Zone mask" v={snap.heatmap.masked ? "on" : "off"} />
              <Row k="Camera state" v={snap.heatmap.cameraKey.slice(0, 18)} />
            </dl>
            <p className="border-t border-line p-4 text-[0.74rem] leading-relaxed text-mist">Colours are relative to the busiest masked cell in the selected window. Older tracked activity is weighted down exponentially. A busy area is not automatically dangerous.</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
