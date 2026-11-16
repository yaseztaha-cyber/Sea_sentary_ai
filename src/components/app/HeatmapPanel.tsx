"use client";

import { useEngine, useSettingsUpdater, useSnapshot } from "./SentryProvider";
import { Btn, Mono, Panel, Pill } from "./ui";
import { HEAT_RAMP } from "@/lib/engine/heatmap";
import type { HeatmapMode } from "@/lib/settings";

const MODES: { id: HeatmapMode; label: string; note: string }[] = [
  { id: "occupancy", label: "Occupancy", note: "Time tracked people spend in each image region." },
  { id: "movement", label: "Movement", note: "Displacement-weighted activity: faster movement counts more." },
  { id: "dwell", label: "Dwell", note: "Areas where tracked people remain nearly stationary for longer." },
];

const WINDOWS: { s: 60 | 300 | 900 | 1800; l: string }[] = [
  { s: 60, l: "1m" },
  { s: 300, l: "5m" },
  { s: 900, l: "15m" },
  { s: 1800, l: "30m" },
];

function gradient(mode: HeatmapMode) {
  const stops = HEAT_RAMP[mode];
  return `linear-gradient(90deg, ${stops.map(([p, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${Math.round(p * 100)}%`).join(", ")})`;
}

export function HeatmapPanel({ overlay, onToggleOverlay }: { overlay: boolean; onToggleOverlay: () => void }) {
  const engine = useEngine();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const h = snap.settings.heatmap;
  const hm = snap.heatmap;
  const mode = MODES.find((m) => m.id === h.mode)!;

  return (
    <Panel
      title="Live activity heatmap"
      action={
        <div className="flex items-center gap-2">
          {hm.live ? <Pill tone="ok" dot>Live track input</Pill> : hm.samples > 0 ? <Pill tone="warn">Historical · no tracks now</Pill> : <Pill tone="idle">Empty</Pill>}
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Heatmap mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={h.mode === m.id}
              onClick={() => update((x) => (x.heatmap.mode = m.id))}
              className={`rounded-[5px] border px-2 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.08em] transition-colors ${h.mode === m.id ? "border-mint/60 bg-mint/15 text-mint" : "border-line bg-depth/40 text-mist hover:text-moon"}`}
              title={m.note}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[0.74rem] leading-relaxed text-mist">{mode.note}</p>

        <div>
          <div className="h-2 w-full rounded-full" style={{ background: gradient(h.mode) }} aria-hidden="true" />
          <div className="mt-1 flex justify-between font-mono text-[0.62rem] text-mist">
            <span>low</span>
            <span>{h.mode === "movement" ? "activity" : h.mode === "dwell" ? "stationary time" : "occupancy"}</span>
            <span>high</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-[0.74rem]">
          <div className="flex justify-between gap-2"><dt className="text-mist">Track samples</dt><dd className="font-mono">{hm.samples.toLocaleString()}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-mist">Active cells</dt><dd className="font-mono">{hm.activeCells}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-mist">Peak dwell</dt><dd className="font-mono">{hm.empty ? "—" : `${hm.peakDwellSeconds.toFixed(1)} s`}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-mist">Last sample</dt><dd className="font-mono">{hm.lastSampleAgeMs === null ? "—" : hm.lastSampleAgeMs < 1500 ? "now" : `${(hm.lastSampleAgeMs / 1000).toFixed(0)}s ago`}</dd></div>
        </dl>

        <div className="flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((w) => (
            <Btn key={w.s} active={h.windowSeconds === w.s} onClick={() => update((x) => (x.heatmap.windowSeconds = w.s))} className="!h-7 !px-2 !text-[0.7rem]">
              {w.l}
            </Btn>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <Btn active={overlay} onClick={onToggleOverlay} className="!h-7 !px-2 !text-[0.7rem]">Overlay {overlay ? "on" : "off"}</Btn>
          <Btn active={h.monitoredOnly} onClick={() => update((x) => (x.heatmap.monitoredOnly = !x.heatmap.monitoredOnly))} className="!h-7 !px-2 !text-[0.7rem]" title="Restrict the map to enabled monitored-area polygons">Monitored area</Btn>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Mono className="text-[0.66rem] text-mist">{hm.masked ? "Masked to configured zones" : "Full frame (no monitored polygons)"} · {hm.cameraKey.slice(0, 18)}</Mono>
          <Btn onClick={() => engine.resetHeatmap()} tone="quiet" className="!h-7 !px-2 !text-[0.68rem]">Reset</Btn>
        </div>

        {hm.empty && (
          <div className="rounded-[5px] border border-dashed border-line bg-abyss/40 p-3">
            <p className="text-[0.8rem] text-moon">No tracked person activity in this window.</p>
            <p className="mt-1 text-[0.72rem] leading-relaxed text-mist">
              The heatmap only receives confirmed, currently tracked person anchors. It does not invent activity, and previous activity fades with time decay.
            </p>
          </div>
        )}
        <p className="text-[0.66rem] leading-relaxed text-mist">Activity density in camera-image space. Not thermal imaging, not a temperature measurement, and not a danger prediction.</p>
      </div>
    </Panel>
  );
}
