import { describe, expect, it } from "vitest";
import { Tracker } from "@/lib/engine/tracker";
import { AnalysisPipeline } from "@/lib/engine/pipeline";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type Zone } from "@/lib/settings";
import type { Detection } from "@/lib/engine/types";

const det = (x: number, y: number, t: number, score = 0.9, frameId = 0): Detection => ({
  box: { x, y, w: 0.08, h: 0.16 },
  score,
  classId: 1,
  label: "person",
  frameId,
  t,
});

const base = (): Settings => mergeSettings(structuredClone(DEFAULT_SETTINGS));
const pool: Zone = { id: 1, name: "Pool", type: "SWIMMING", enabled: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const ts = () => new Date().toISOString();

describe("tracker", () => {
  it("keeps one anonymous ID for a person moving across the frame", () => {
    const t = new Tracker({ ...base().tracking, minHits: 2, maxLostSeconds: 2.5 }, 0.5);
    const ids = new Set<number>();
    for (let i = 0; i < 20; i++) {
      t.update([det(0.1 + i * 0.015, 0.45, 100 + i * 0.2)], 100 + i * 0.2);
      t.confirmed().forEach((x) => ids.add(x.id));
    }
    expect(ids.size).toBe(1);
    const tr = t.confirmed()[0];
    expect(tr.history.length).toBe(20);
    expect(tr.state).toBe("tracked");
  });

  it("re-associates after a short interruption and records the real gap", () => {
    const t = new Tracker({ ...base().tracking, minHits: 2, maxLostSeconds: 3 }, 0.5);
    for (let i = 0; i < 10; i++) t.update([det(0.3, 0.4, 100 + i * 0.2)], 100 + i * 0.2);
    const id = t.confirmed()[0].id;
    // 1.2 s with no detection (still below maxLostSeconds)
    for (let i = 0; i < 6; i++) t.update([], 102.2 + i * 0.2);
    expect(t.confirmed()[0].state).toBe("lost");
    t.update([det(0.31, 0.4, 103.6)], 103.6);
    const tr = t.confirmed()[0];
    expect(tr.id).toBe(id);
    expect(tr.gaps.length).toBe(1);
    expect(tr.gaps[0]).toBeGreaterThan(1);
    expect(tr.gapEvents[0].t).toBe(103.6);
  });

  it("keeps two people as separate tracks", () => {
    const t = new Tracker({ ...base().tracking, minHits: 1, maxLostSeconds: 2 }, 0.5);
    for (let i = 0; i < 10; i++) t.update([det(0.1 + i * 0.01, 0.3, 100 + i * 0.2), det(0.7 - i * 0.01, 0.6, 100 + i * 0.2)], 100 + i * 0.2);
    expect(t.confirmed().length).toBe(2);
    expect(new Set(t.confirmed().map((x) => x.id)).size).toBe(2);
  });
});

describe("pipeline integration", () => {
  it("adds heat-map samples only while the track is confirmed/tracked", () => {
    const s = base();
    s.tracking.minHits = 2;
    const p = new AnalysisPipeline(s);
    for (let i = 0; i < 8; i++) p.process([det(0.2 + i * 0.02, 0.45, 100 + i * 0.2)], 100 + i * 0.2, s, [pool], ts);
    const afterTracked = p.heatmap.samples;
    expect(afterTracked).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) p.process([], 101.6 + i * 0.2, s, [pool], ts);
    expect(p.heatmap.samples).toBe(afterTracked);
  });

  it("keeps camera heatmaps separate and preserves them when switching back", () => {
    const s = base();
    s.tracking.minHits = 1;
    const p = new AnalysisPipeline(s);
    p.setCamera("camA");
    p.process([det(0.2, 0.3, 100)], 100, s, [pool], ts);
    const aSamples = p.heatmap.samples;
    expect(aSamples).toBe(1);
    p.setCamera("camB");
    expect(p.heatmap.samples).toBe(0);
    p.setCamera("camA");
    expect(p.heatmap.samples).toBe(aSamples);
  });

  it("adds no heat when no people are detected", () => {
    const s = base();
    const p = new AnalysisPipeline(s);
    for (let i = 0; i < 20; i++) p.process([], 100 + i * 0.5, s, [pool], ts);
    expect(p.heatmap.samples).toBe(0);
    expect(p.heatmap.compute(60, 110, "occupancy").buckets).toBe(0);
  });

  it("returns structured assessments from real track history", () => {
    const s = base();
    s.tracking.minHits = 1;
    const p = new AnalysisPipeline(s);
    for (let i = 0; i < 30; i++) p.process([det(0.2 + i * 0.005, 0.45, 100 + i * 0.2)], 100 + i * 0.2, s, [pool], ts);
    const a = [...p.distress.assessments.values()][0];
    expect(a).toBeTruthy();
    expect(a.trackId).toBe(1);
    expect(a.scoreKind).toBe("unvalidated-heuristic");
    expect(a.modelConfidence).toBeNull();
    expect(a.zone).toBe("Pool");
    expect(a).toHaveProperty("indicators");
    expect(a).toHaveProperty("limitations");
  });
});
