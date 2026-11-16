"use client";

import { useEffect, useRef, useState } from "react";
import { CocoSsdDetector } from "@/lib/engine/detector";
import { AnalysisPipeline } from "@/lib/engine/pipeline";
import { drawDetectionsOnly, drawTracks } from "@/lib/engine/draw";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings";
import type { Detection } from "@/lib/engine/types";
import { Reveal } from "./Reveal";

type Tab = "raw" | "detected" | "tracked" | "heat";
const TABS: { id: Tab; label: string; note: string }[] = [
  { id: "raw", label: "Raw video", note: "The recorded demo clip, untouched." },
  { id: "detected", label: "Detected", note: "Person detections from the model, frame by frame." },
  { id: "tracked", label: "Tracked", note: "Anonymous IDs and the paths they actually travelled." },
  { id: "heat", label: "Activity map", note: "Where tracked people spent time, accumulated from real tracks." },
];

const SETTINGS = mergeSettings({ ...DEFAULT_SETTINGS, tracking: { ...DEFAULT_SETTINGS.tracking, minHits: 2, maxLostSeconds: 2 } });
let detectorSingleton: CocoSsdDetector | null = null;

export function Experience() {
  const [tab, setTab] = useState<Tab>("raw");
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState({ persons: 0, latency: 0, passes: 1, backend: "" });
  const [playing, setPlaying] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const pipe = useRef<AnalysisPipeline | null>(null);
  const last = useRef<{ dets: Detection[]; mediaTime: number }>({ dets: [], mediaTime: -1 });
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const inView = useRef(false);

  useEffect(() => {
    pipe.current = new AnalysisPipeline(SETTINGS);
  }, []);

  // visibility: only play / process while the workspace is on screen
  useEffect(() => {
    const el = box.current;
    const v = video.current;
    if (!el || !v) return;
    const io = new IntersectionObserver(([e]) => {
      inView.current = e.isIntersecting;
      if (e.isIntersecting && playing && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [playing]);

  // lazy-load the real model the first time an AI tab is opened
  useEffect(() => {
    if (tab === "raw" || model !== "idle") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModel("loading");
    detectorSingleton ??= new CocoSsdDetector();
    detectorSingleton
      .load()
      .then(() => {
        setModel("ready");
        setStats((s) => ({ ...s, backend: detectorSingleton!.backend }));
      })
      .catch((e: Error) => {
        setModel("unavailable");
        setErr(e.message || "The model could not be loaded.");
      });
  }, [tab, model]);

  // real inference loop on real frames of the clip
  useEffect(() => {
    if (model !== "ready") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let frame = 0;
    let lastMedia = 0;
    let passes = 1;
    const tick = async () => {
      const v = video.current;
      const p = pipe.current;
      const det = detectorSingleton;
      const t0 = performance.now();
      if (v && p && det && tabRef.current !== "raw" && inView.current && !v.paused && v.readyState >= 2 && v.videoWidth) {
        try {
          if (v.currentTime < lastMedia - 1) {
            p.tracker.reset(); // clip looped: new pass, keep accumulated activity map
            passes++;
          }
          lastMedia = v.currentTime;
          const media = v.currentTime;
          const { detections, latencyMs } = await det.detect(v, v.videoWidth, v.videoHeight, frame++, performance.now() / 1000, { minScore: 0.5, maxDetections: 20, inputSize: 640 });
          p.process(detections, performance.now() / 1000, SETTINGS, [], () => new Date().toISOString(), false);
          last.current = { dets: detections.filter((d) => d.score >= 0.5), mediaTime: media };
          setStats((s) => ({ ...s, persons: last.current.dets.length, latency: latencyMs, passes }));
        } catch (e) {
          setModel("unavailable");
          setErr((e as Error).message);
          return;
        }
      }
      if (!stop) timer = setTimeout(tick, Math.max(30, 110 - (performance.now() - t0)));
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [model]);

  // overlay drawing
  useEffect(() => {
    const cv = canvas.current;
    const el = box.current;
    if (!cv || !el) return;
    const heat = document.createElement("canvas");
    let heatAt = 0;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(el.clientWidth * dpr);
      cv.height = Math.round(el.clientHeight * dpr);
      heat.width = cv.width;
      heat.height = cv.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const p = pipe.current;
      const v = video.current;
      const tb = tabRef.current;
      if (!p || !v || tb === "raw") return;
      const now = performance.now() / 1000;
      if (tb === "detected") {
        if (Math.abs(v.currentTime - last.current.mediaTime) < 0.5) drawDetectionsOnly(ctx, cv.width, cv.height, last.current.dets);
      } else if (tb === "tracked") {
        drawTracks(ctx, cv.width, cv.height, p.tracker.confirmed(), now, { boxes: true, trails: true }, 10);
      } else {
        if (ts - heatAt > 600) {
          heatAt = ts;
          const hc = heat.getContext("2d")!;
          hc.clearRect(0, 0, heat.width, heat.height);
          p.heatmap.render(hc, heat.width, heat.height, 1800, now, 1.4, 0.85);
        }
        ctx.drawImage(heat, 0, 0);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const current = TABS.find((t) => t.id === tab)!;
  // eslint-disable-next-line react-hooks/refs
  const heatEmpty = tab === "heat" && model === "ready" && (pipe.current?.heatmap.samples ?? 0) === 0;

  return (
    <section id="experience" className="relative bg-abyss pb-36 pt-24 md:pt-32">
      <div className="mx-auto max-w-[1560px] px-6 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal><p className="eyebrow mb-6">04 — The intelligence experience</p></Reveal>
            <Reveal delay={0.1}>
              <h2 className="font-display text-[clamp(2.4rem,6vw,6rem)] font-medium uppercase leading-[0.95] tracking-[-0.02em]">See what the <span className="font-serif-i normal-case text-glass">system sees.</span></h2>
            </Reveal>
          </div>
          <Reveal delay={0.2}><p className="max-w-xs text-[0.95rem] leading-relaxed text-mist">Real inference, running in your browser on a recorded clip. Nothing here is simulated.</p></Reveal>
        </div>

        <div role="tablist" aria-label="Demonstration views" className="mt-12 flex flex-wrap gap-x-10 gap-y-3 border-b border-line">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`relative pb-4 font-display text-[1.05rem] font-medium uppercase tracking-[0.08em] transition-colors md:text-[1.3rem] ${tab === t.id ? "text-moon" : "text-mist hover:text-moon"}`}>
              {t.label}
              <span className={`absolute -bottom-px left-0 h-[2px] bg-mint transition-all duration-500 ${tab === t.id ? "w-full" : "w-0"}`} />
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div ref={box} className="relative aspect-video overflow-hidden rounded-[8px_90px_8px_8px] border border-line bg-black shadow-[0_40px_120px_rgba(0,0,0,0.55)] max-md:rounded-[8px]">
            <video ref={video} src="/video/demo.mp4" poster="/imagery/demo-poster.jpg" muted loop playsInline preload="metadata" className={`absolute inset-0 h-full w-full object-cover transition-[filter] duration-700 ${tab === "heat" ? "brightness-[0.5] saturate-50" : ""}`} aria-label="Demonstration clip of two people on a beach" />
            <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
            <div className="absolute left-3 top-3 flex gap-2">
              <span className="rounded bg-abyss/80 px-2 py-1 font-mono text-[0.68rem] tracking-wider text-glass">RECORDED CLIP · NOT LIVE</span>
            </div>
            <button onClick={toggle} className="absolute bottom-3 left-3 rounded bg-abyss/80 px-3 py-1.5 text-[0.72rem] uppercase tracking-wider text-moon hover:text-mint" aria-label={playing ? "Pause clip" : "Play clip"}>{playing ? "Pause" : "Play"}</button>

            {tab !== "raw" && model === "loading" && (
              <div className="absolute inset-0 grid place-items-center bg-abyss/70 backdrop-blur-sm">
                <div className="text-center"><p className="font-display text-xl">Loading person detector…</p><p className="mt-1 text-[0.8rem] text-mist">COCO-SSD · runs locally in your browser</p></div>
              </div>
            )}
            {tab !== "raw" && model === "unavailable" && (
              <div className="absolute inset-0 grid place-items-center bg-abyss/90 p-6 text-center">
                <div><p className="font-display text-xl text-amber">Demonstration unavailable</p><p className="mx-auto mt-2 max-w-sm text-[0.85rem] text-mist">The detection model could not run in this browser{err ? ` (${err})` : ""}. The raw clip is still available. No results are being simulated.</p></div>
              </div>
            )}
            {heatEmpty && <div className="absolute inset-x-0 bottom-3 grid place-items-center"><span className="rounded bg-abyss/85 px-3 py-1.5 text-[0.78rem] text-mist">Collecting tracks… the map fills as people are tracked.</span></div>}
          </div>

          <aside className="flex flex-col justify-between gap-6">
            <div>
              <p className="font-display text-2xl font-medium uppercase">{current.label}</p>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-mist">{current.note}</p>
            </div>
            <dl className="space-y-3 border-t border-line pt-5 font-mono text-[0.78rem]">
              <div className="flex justify-between"><dt className="text-mist">Model</dt><dd>{model === "ready" ? "ready" : model}</dd></div>
              <div className="flex justify-between"><dt className="text-mist">Persons in frame</dt><dd>{model === "ready" && tab !== "raw" ? stats.persons : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-mist">Inference</dt><dd>{model === "ready" && stats.latency ? `${stats.latency.toFixed(0)} ms · ${stats.backend}` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-mist">Clip passes</dt><dd>{model === "ready" ? stats.passes : "—"}</dd></div>
            </dl>
            <p className="text-[0.72rem] leading-relaxed text-mist/80">Footage: Pexels (free licence). Activity is people density in image space — not thermal imaging, and not a measure of danger.</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
