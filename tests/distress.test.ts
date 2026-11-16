import { describe, expect, it } from "vitest";
import { TemporalDistressAnalyzer } from "@/lib/engine/distress";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type Zone } from "@/lib/settings";
import type { Track } from "@/lib/engine/types";

const settings = (): Settings => mergeSettings(structuredClone(DEFAULT_SETTINGS));
const pool: Zone = { id: 1, name: "Pool", type: "SWIMMING", enabled: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const leftPool: Zone = { id: 1, name: "Pool", type: "SWIMMING", enabled: true, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }] };
const wall = () => new Date().toISOString();

function makeTrack(id: number, pts: { t: number; cx: number; cy: number; w: number; h: number }[], gaps: { t: number; seconds: number }[] = [], stationarySeconds = 0): Track {
  const last = pts[pts.length - 1];
  const prev = pts[Math.max(0, pts.length - 2)];
  const dt = Math.max(0.1, last.t - prev.t);
  return {
    id,
    box: { x: last.cx - last.w / 2, y: last.cy - last.h / 2, w: last.w, h: last.h },
    state: "tracked",
    firstT: pts[0].t,
    lastT: last.t,
    lostSince: null,
    hits: pts.length,
    misses: 0,
    totalMisses: 0,
    gaps: gaps.map((g) => g.seconds),
    gapEvents: gaps,
    vx: (last.cx - prev.cx) / dt,
    vy: (last.cy - prev.cy) / dt,
    score: 0.85,
    lastDetScore: 0.85,
    history: pts.map((p) => ({ t: p.t, cx: p.cx, cy: p.cy, w: p.w, h: p.h, score: 0.85 })),
    stationarySeconds,
    speed: Math.hypot(last.cx - prev.cx, last.cy - prev.cy) / dt,
    reacquisitions: gaps.length,
  };
}

function normalSwim(id = 1): Track {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ t: 100 + i * 0.2, cx: 0.15 + i * 0.006, cy: 0.5 + Math.sin(i / 20) * 0.01, w: 0.1, h: 0.05 });
  return makeTrack(id, pts);
}

function floating(id = 2): Track {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ t: 100 + i * 0.2, cx: 0.5, cy: 0.5, w: 0.1, h: 0.05 });
  return makeTrack(id, pts, [], 20);
}

function verticalStill(id = 3): Track {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ t: 100 + i * 0.2, cx: 0.5, cy: 0.5, w: 0.05, h: 0.12 });
  return makeTrack(id, pts, [], 20);
}

function struggling(id = 4, gapCount = 4): Track {
  const pts = [];
  for (let i = 0; i <= 300; i++) {
    pts.push({ t: 100 + i * 0.2, cx: i % 2 === 0 ? 0.45 : 0.55, cy: i % 2 === 0 ? 0.45 : 0.55, w: 0.05, h: 0.12 });
  }
  const gaps = Array.from({ length: gapCount }, (_, i) => ({ t: 105 + i * 8, seconds: 1.4 }));
  return makeTrack(id, pts, gaps);
}

function run(analyzer: TemporalDistressAnalyzer, track: Track, s: Settings, zones: Zone[], from = track.lastT, seconds = 20) {
  const levels: string[] = [];
  const obs = [];
  for (let t = from; t <= from + seconds; t += 0.2) {
    const history = track.history.filter((p) => p.t <= t);
    const last = history[history.length - 1];
    const sliced: Track = { ...track, history, box: last ? { x: last.cx - last.w / 2, y: last.cy - last.h / 2, w: last.w, h: last.h } : track.box, gapEvents: track.gapEvents.filter((g) => g.t <= t) };
    const r = analyzer.evaluate({ tracks: [sliced], zones, settings: s, now: t, wallClock: wall, camera: "cam-test" });
    levels.push(...r.assessments.map((a) => a.level));
    obs.push(...r.observations);
  }
  return { levels, obs };
}

describe("temporal swimmer-distress assessment", () => {
  it("does not alarm on normal swimming across the frame", () => {
    const a = new TemporalDistressAnalyzer();
    const r = run(a, normalSwim(), settings(), [pool]);
    expect(r.levels).not.toContain("SUSPECTED");
    expect(r.levels).not.toContain("CRITICAL");
    expect(r.obs.filter((o) => o.level >= 3).length).toBe(0);
  });

  it("does not alarm on floating or resting", () => {
    const a = new TemporalDistressAnalyzer();
    const r = run(a, floating(), settings(), [pool]);
    expect(r.levels).not.toContain("SUSPECTED");
    expect(r.levels).not.toContain("CRITICAL");
  });

  it("treats standing still in shallow water as WATCH at most, never an emergency", () => {
    const a = new TemporalDistressAnalyzer();
    const r = run(a, verticalStill(), settings(), [pool]);
    expect(r.levels).not.toContain("CRITICAL");
    expect(r.levels).not.toContain("SUSPECTED");
    expect(r.obs.every((o) => o.level <= 2)).toBe(true);
  });

  it("does not treat a single dive/submersion gap as suspected distress", () => {
    const a = new TemporalDistressAnalyzer();
    const t = normalSwim(9);
    t.gapEvents = [{ t: 110, seconds: 1.6 }];
    t.gaps = [1.6];
    const r = run(a, t, settings(), [pool]);
    expect(r.levels).not.toContain("CRITICAL");
    expect(r.levels).not.toContain("SUSPECTED");
  });

  it("reaches CRITICAL only after multiple indicators persist", () => {
    const a = new TemporalDistressAnalyzer();
    const t = struggling();
    const onceTrack: Track = { ...t, history: t.history.filter((p) => p.t <= 130), gapEvents: t.gapEvents.filter((g) => g.t <= 130) };
    const once = a.evaluate({ tracks: [onceTrack], zones: [pool], settings: settings(), now: 130, wallClock: wall, camera: "cam-test" });
    // A single assessment call cannot produce a confirmed critical level.
    expect(once.assessments[0].level).toBe("NORMAL");
    const r = run(a, t, settings(), [pool], 130, 20);
    expect(r.levels).toContain("CRITICAL");
    const critical = r.obs.find((o) => o.level === 4);
    expect(critical).toBeTruthy();
    expect(critical!.assessment?.indicators.some((i) => i.key === "submersion" && i.available)).toBe(true);
    expect(critical!.assessment?.indicators.some((i) => i.key === "headWaterline" && !i.available)).toBe(true);
    expect(critical!.assessment?.modelConfidence).toBeNull();
    expect(critical!.riskLevel).toBe("CRITICAL");
    expect(critical!.summary.toLowerCase()).toContain("suspected");
    expect(critical!.summary.toLowerCase()).toContain("not a confirmed drowning");
  });

  it("reaches SUSPECTED (not CRITICAL) with two submersion events and struggling", () => {
    const a = new TemporalDistressAnalyzer();
    const r = run(a, struggling(7, 2), settings(), [pool], 130, 30);
    expect(r.levels).toContain("SUSPECTED");
    expect(r.levels).not.toContain("CRITICAL");
  });

  it("caps a track outside configured water zones at WATCH", () => {
    const a = new TemporalDistressAnalyzer();
    const t = struggling(8);
    // move the track outside the left-side pool
    t.history = t.history.map((p) => ({ ...p, cx: 0.8 }));
    t.box = { ...t.box, x: 0.75 };
    const r = run(a, t, settings(), [leftPool], t.lastT, 25);
    expect(r.levels).not.toContain("SUSPECTED");
    expect(r.levels).not.toContain("CRITICAL");
    expect(r.obs.every((o) => o.level <= 2)).toBe(true);
  });

  it("returns a structured assessment even for NORMAL", () => {
    const a = new TemporalDistressAnalyzer();
    const r = a.evaluate({ tracks: [normalSwim()], zones: [pool], settings: settings(), now: 120, wallClock: wall, camera: "cam-test" });
    const x = r.assessments[0];
    expect(x.trackId).toBe(1);
    expect(x.level).toBe("NORMAL");
    expect(x.anchor.x).toBeGreaterThan(0);
    expect(x.box.w).toBeGreaterThan(0);
    expect(x.zone).toBe("Pool");
    expect(x.camera).toBe("cam-test");
    expect(x.requiresReview).toBe(false);
    expect(x.limitations.length).toBeGreaterThan(0);
  });
});
