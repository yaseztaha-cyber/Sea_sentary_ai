"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useEngine, useSnapshot } from "./SentryProvider";
import { drawTracks, drawZones } from "@/lib/engine/draw";
import { HEAT_RAMP } from "@/lib/engine/heatmap";
import type { Pt } from "@/lib/settings";
import { Btn, monitoringStatus, Pill } from "./ui";

export type Layers = { boxes: boolean; trails: boolean; zones: boolean; heat: boolean };

type Props = {
  layers: Layers;
  stageRef: RefObject<HTMLDivElement | null>;
  compare?: boolean;
  draw?: { active: boolean; draft: Pt[]; color: string; onAdd: (p: Pt) => void; onClose: () => void };
};

export function VideoStage({ layers, stageRef, compare, draw }: Props) {
  const engine = useEngine();
  const snap = useSnapshot();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [split, setSplit] = useState(0.5);
  const layersRef = useRef(layers);
  const drawRef = useRef(draw);
  const heatCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastHeatMsRef = useRef(0);

  useEffect(() => {
    layersRef.current = layers;
    drawRef.current = draw;
  }, [layers, draw]);

  const ratio = snap.camera.width && snap.camera.height ? snap.camera.width / snap.camera.height : 16 / 9;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== engine.stream) {
      v.srcObject = engine.stream;
      if (engine.stream) void v.play().catch(() => {});
    }
  }, [engine, snap.camera.state, snap.camera.deviceId]);

  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [stageRef]);

  // overlay render loop
  useEffect(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const heatCv = document.createElement("canvas");
    let heatAt = 0;
    let raf = 0;
    let last = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(2, Math.round(box.clientWidth * dpr));
      cv.height = Math.max(2, Math.round(box.clientHeight * dpr));
      heatCv.width = cv.width;
      heatCv.height = cv.height;
      heatAt = 0;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 33) return;
      last = ts;
      const ctx = cv.getContext("2d")!;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const L = layersRef.current;
      const s = engine.settings;
      const now = performance.now() / 1000;
      if (L.heat) {
        if (ts - heatAt > 700) {
          heatAt = ts;
          const hc = heatCv.getContext("2d")!;
          hc.clearRect(0, 0, w, h);
          engine.pipeline.heatmap.render(hc, w, h, s.heatmap.windowSeconds, now, s.heatmap.intensity, s.heatmap.opacity, s.heatmap.mode, s.heatmap.decayHalfLifeSeconds);
        }
        ctx.drawImage(heatCv, 0, 0);
      }
      const d = drawRef.current;
      if (L.zones || d?.active) drawZones(ctx, w, h, engine.zones, { draft: d?.draft, draftColor: d?.color });
      if (L.boxes || L.trails) drawTracks(ctx, w, h, engine.pipeline.tracker.confirmed(), now, L, s.tracking.trailSeconds, engine.pipeline.distress.levels, s.tracking.trailMaxGapSeconds);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine]);

  const status = monitoringStatus(snap);
  const live = snap.camera.live;
  const hasStream = snap.camera.state === "connected" || snap.camera.state === "degraded";

  const onCanvasClick = (e: React.MouseEvent) => {
    const d = drawRef.current;
    if (!d?.active) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    d.onAdd({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };

  const startDrag = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setSplit(Math.min(0.97, Math.max(0.03, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={stageRef} className={`flex items-center justify-center bg-[#020807] ${fs ? "h-screen w-screen" : "w-full"}`}>
      <div ref={boxRef} className="relative w-full overflow-hidden bg-[#020807]" style={{ aspectRatio: String(ratio), maxWidth: fs ? `calc(100vh * ${ratio})` : undefined }}>
        <video ref={videoRef} muted playsInline autoPlay className="absolute inset-0 h-full w-full object-contain" />
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onDoubleClick={() => drawRef.current?.active && drawRef.current.onClose()}
          className={`absolute inset-0 h-full w-full ${draw?.active ? "cursor-crosshair" : ""}`}
          style={compare ? { clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` } : undefined}
        />
        {compare && hasStream && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-moon/70" style={{ left: `${split * 100}%` }} />
            <div onPointerDown={startDrag} className="absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-moon/60 bg-abyss/80 text-moon" style={{ left: `${split * 100}%` }} role="slider" aria-label="Compare raw and heat map" aria-valuenow={Math.round(split * 100)}>
              <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 1 1 5l3 4M12 1l3 4-3 4" /></svg>
            </div>
            <span className="absolute bottom-3 left-3 rounded bg-abyss/80 px-2 py-1 font-mono text-[0.68rem] text-glass">HEAT MAP</span>
            <span className="absolute bottom-3 right-3 rounded bg-abyss/80 px-2 py-1 font-mono text-[0.68rem] text-glass">RAW</span>
          </>
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md bg-abyss/65 p-1.5 backdrop-blur-[2px]">
          {live ? <Pill tone="ok" dot>Live</Pill> : <Pill tone={status.tone}>{hasStream ? "Frozen · not live" : "No signal"}</Pill>}
          {snap.ai.enabled && live && <Pill tone="info">AI {snap.ai.inferFps.toFixed(1)} fps</Pill>}
        </div>
        {live && <div className="pointer-events-none absolute right-3 top-3 max-w-[52%] truncate rounded bg-abyss/65 px-2 py-1 text-right font-mono text-[0.7rem] text-moon/80 backdrop-blur-[2px]">{snap.camera.label ? `${snap.camera.label} · ` : ""}{snap.camera.width}×{snap.camera.height} · {snap.camera.captureFps.toFixed(0)} fps</div>}
        {hasStream && /virtual/i.test(snap.camera.label ?? "") && (
          <div className="pointer-events-none absolute inset-x-3 top-14 rounded border border-amber/60 bg-abyss/90 px-3 py-2 text-[0.72rem] text-amber">
            VIRTUAL CAMERA SOURCE — this is not a physical-camera feed. Choose your real webcam in Settings → Camera source.
          </div>
        )}
        {draw?.active && <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-abyss/85 px-3 py-1.5 text-[0.75rem] text-mint">Click to add points · press “Close zone” to finish</div>}
        {!hasStream && (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-ocean to-abyss p-6 text-center">
            <div className="max-w-sm">
              <p className="font-display text-xl text-moon">{snap.camera.state === "connecting" ? "Connecting to camera…" : snap.camera.state === "error" ? "Camera error" : "No camera connected"}</p>
              <p className="mt-2 text-[0.85rem] text-mist">{snap.camera.error ?? "Connect a USB webcam to begin monitoring. No video is simulated."}</p>
              {snap.camera.state !== "connecting" && (
                <div className="mt-4 flex justify-center gap-2">
                  <Btn tone="primary" onClick={() => void engine.connect()}>{snap.camera.state === "error" ? "Retry" : "Connect camera"}</Btn>
                </div>
              )}
            </div>
          </div>
        )}
        {hasStream && !live && (
          <div className="absolute inset-0 grid place-items-center bg-abyss/55">
            <p className="rounded bg-abyss/90 px-4 py-2 text-[0.85rem] text-amber">{snap.camera.error ?? "Waiting for frames…"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
