"use client";

import { useSnapshot } from "./SentryProvider";
import { ExperimentalTag, Mono, Row, type Tone } from "./ui";
import { RISK_LABEL } from "@/lib/settings";

export function Inspector() {
  const { camera: c, ai, tracks, distress, perf } = useSnapshot();
  const camTone: Tone = c.state === "connected" && c.live ? "ok" : c.state === "disconnected" ? "idle" : c.state === "connecting" ? "info" : c.state === "degraded" ? "warn" : "alert";
  const modelLabel = ai.model === "ready" ? "Ready" : ai.model === "loading" ? "Loading" : ai.model === "unavailable" ? "Unavailable" : "Not loaded";
  const lvl = [1, 2, 3, 4].map((l) => tracks.filter((t) => t.level === l).length);
  const riskTone = (r: string) => (r === "CRITICAL" ? "text-coral" : r === "SUSPECTED" ? "text-amber" : r === "WATCH" ? "text-glass" : "text-mist");
  return (
    <div className="space-y-4 p-4">
      <dl>
        <Row k="Camera" v={c.label ?? "—"} />
        <Row k="Connection" v={c.state + (c.state === "connected" && !c.live ? " (stale)" : "")} tone={camTone} />
        <Row k="Resolution (actual)" v={c.width ? `${c.width} × ${c.height}` : "—"} />
        <Row k="Capture FPS (measured)" v={c.live ? c.captureFps.toFixed(1) : "—"} />
        <Row k="Device-reported FPS" v={c.actualFps ? c.actualFps.toFixed(0) : "—"} />
        <Row k="Pixel format" v={<span className="text-mist">not exposed by browser</span>} />
        <Row k="Frames captured" v={c.frames.toLocaleString()} />
      </dl>
      <div>
        <h3 className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-glass">AI</h3>
        <dl>
          <Row k="Model" v={modelLabel} tone={ai.model === "ready" ? "ok" : ai.model === "unavailable" ? "alert" : undefined} />
          <Row k="Provider (verified)" v={ai.model === "ready" ? `TF.js · ${ai.backend}` : "—"} tone={ai.model === "ready" ? "ok" : undefined} />
          <Row k="Input size" v={`${ai.inputSize}px`} />
          <Row k="Derived from" v={ai.model === "ready" ? ai.backendReason : "—"} />
          <Row k="Inference rate" v={ai.enabled && ai.inferenceFrames ? `${ai.detectorRate.toFixed(2)} /s` : "—"} />
          <Row k="Tracking update rate" v={ai.enabled ? `${ai.trackingRate.toFixed(2)} /s` : "—"} />
          <Row k="Latency last / avg / p95" v={ai.inferenceFrames ? `${ai.latencyMs.toFixed(0)} / ${ai.avgLatencyMs.toFixed(0)} / ${ai.p95LatencyMs.toFixed(0)} ms` : "—"} />
          <Row k="Preprocess / frame age" v={ai.inferenceFrames ? `${ai.preprocessMs.toFixed(0)} / ${ai.queueDelayMs.toFixed(0)} ms` : "—"} />
          <Row k="Frames skipped" v={ai.inferenceFrames ? c.drops.toLocaleString() : "—"} />
          <Row k="Persons now" v={ai.enabled ? ai.detections : "—"} />
          <Row k="Tracked / lost" v={ai.enabled ? `${ai.tracked} / ${ai.lost}` : "—"} />
          <Row k="Server CPU / RAM" v={perf.serverCpuPercent !== null ? `${perf.serverCpuPercent.toFixed(1)}% · ${perf.serverRssMb} MB` : "—"} />
          <Row k="End-to-end alert" v={perf.alertLatencyMs !== null ? `${perf.alertLatencyMs} ms` : "—"} />
        </dl>
        {ai.modelError && <p className="mt-2 text-[0.76rem] text-coral">{ai.modelError}</p>}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-glass">Tracks</h3>
          <Mono className="text-mist">N {lvl[0]} · W {lvl[1]} · S {lvl[2]} · C {lvl[3]}</Mono>
        </div>
        {tracks.length === 0 ? (
          <p className="text-[0.78rem] text-mist">No tracked people.</p>
        ) : (
          <table className="w-full text-left text-[0.74rem]">
            <thead className="text-mist">
              <tr><th className="pb-1 font-medium">ID</th><th className="font-medium">Risk</th><th className="font-medium">Score</th><th className="font-medium">Age</th><th className="font-medium">Zone</th></tr>
            </thead>
            <tbody className="font-mono">
              {tracks.map((t) => (
                <tr key={t.id} className="border-t border-line/60">
                  <td className="py-1 text-mint">#{t.id}</td>
                  <td className={riskTone(t.risk)}>{RISK_LABEL[t.risk]}</td>
                  <td>{t.heuristicScore.toFixed(2)}</td>
                  <td>{t.ageS.toFixed(0)}s</td>
                  <td className="max-w-[90px] truncate">{t.zone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[0.68rem] leading-relaxed text-mist">Score is a heuristic indicator sum, not a probability.</p>
        <div className="mt-3"><ExperimentalTag /></div>
        <p className="mt-2 font-mono text-[0.66rem] text-mist">{distress.modelStatus}</p>
      </div>
    </div>
  );
}
