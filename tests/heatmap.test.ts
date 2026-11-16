import { describe, expect, it } from "vitest";
import { HeatMap, HeatMapBank, GW, GH } from "@/lib/engine/heatmap";
import type { Zone } from "@/lib/settings";

const sum = (g: Float32Array) => g.reduce((a, b) => a + b, 0);
const cellSum = (g: Float32Array, x0: number, x1: number) => {
  let s = 0;
  for (let y = 0; y < GH; y++) for (let x = Math.floor(x0 * GW); x < Math.floor(x1 * GW); x++) s += g[y * GW + x];
  return s;
};

describe("tracking-driven heatmap", () => {
  it("records one moving person along the actual anchor path", () => {
    const h = new HeatMap();
    for (let i = 0; i <= 40; i++) {
      const t = 100 + i * 0.5;
      h.add({ x: 0.2 + 0.6 * (i / 40), y: 0.5, dt: 0.5, tSec: t, speed: 0.05, stationarySeconds: 0 });
    }
    const r = h.compute(60, 120.5, "occupancy");
    expect(h.samples).toBe(41);
    expect(r.peak).toBeGreaterThan(0);
    expect(cellSum(r.grid, 0.1, 0.35)).toBeGreaterThan(0);
    expect(cellSum(r.grid, 0.65, 0.9)).toBeGreaterThan(0);
    expect(cellSum(r.grid, 0.35, 0.65)).toBeGreaterThan(0);
  });

  it("supports multiple simultaneous people", () => {
    const h = new HeatMap();
    for (let i = 0; i < 20; i++) {
      h.add({ x: 0.2, y: 0.3, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.01, stationarySeconds: i * 0.5 });
      h.add({ x: 0.8, y: 0.7, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.01, stationarySeconds: i * 0.5 });
    }
    const r = h.compute(60, 110, "occupancy");
    expect(cellSum(r.grid, 0.1, 0.3)).toBeGreaterThan(0);
    expect(cellSum(r.grid, 0.7, 0.9)).toBeGreaterThan(0);
  });

  it("shows dwell for a person who stays in one area, and little movement", () => {
    const h = new HeatMap();
    for (let i = 0; i < 40; i++) {
      h.add({ x: 0.5, y: 0.5, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.001, stationarySeconds: i * 0.5 });
    }
    const dwell = h.compute(60, 120, "dwell");
    const move = h.compute(60, 120, "movement");
    expect(dwell.peak).toBeGreaterThan(0);
    expect(dwell.peak).toBeGreaterThan(move.peak * 10);
  });

  it("is empty with no people and decays old activity", () => {
    const h = new HeatMap();
    expect(h.compute(300, 100, "occupancy").buckets).toBe(0);
    for (let i = 0; i < 10; i++) h.add({ x: 0.4, y: 0.4, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.03, stationarySeconds: 0 });
    const fresh = h.compute(300, 105, "occupancy", 40);
    const old = h.compute(300, 205, "occupancy", 40);
    expect(fresh.peak).toBeGreaterThan(0);
    expect(old.peak).toBeLessThan(fresh.peak * 0.4);
    expect(h.compute(60, 400, "occupancy").buckets).toBe(0);
  });

  it("does not add activity for an interval with no tracked samples", () => {
    const h = new HeatMap();
    for (let i = 0; i < 10; i++) h.add({ x: 0.3, y: 0.5, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.05, stationarySeconds: 0 });
    const before = h.samples;
    // 30 seconds with no valid track: no add() calls at all
    const during = h.compute(60, 140, "occupancy");
    expect(h.samples).toBe(before);
    expect(during.peak).toBeLessThan(h.compute(60, 105, "occupancy").peak);
  });

  it("masks activity to monitored zones and subtracts ignore zones", () => {
    const h = new HeatMap();
    const zones: Zone[] = [
      { id: 1, name: "swim", type: "SWIMMING", enabled: true, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }] },
      { id: 2, name: "ignore", type: "IGNORE", enabled: true, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }] },
    ];
    h.setMonitoredZones(zones, true);
    for (let i = 0; i < 10; i++) {
      h.add({ x: 0.3, y: 0.5, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.02, stationarySeconds: 0 });
      h.add({ x: 0.8, y: 0.5, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.02, stationarySeconds: 0 });
      h.add({ x: 0.15, y: 0.15, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.02, stationarySeconds: 0 });
    }
    const r = h.compute(60, 105, "occupancy");
    expect(r.masked).toBe(true);
    expect(cellSum(r.grid, 0.21, 0.45)).toBeGreaterThan(0);
    expect(cellSum(r.grid, 0.6, 0.95)).toBe(0);
    expect(r.grid[Math.floor(0.15 * GH) * GW + Math.floor(0.15 * GW)]).toBe(0);
  });

  it("keeps an independent map per camera", () => {
    const bank = new HeatMapBank();
    const a = bank.get("cam-a");
    for (let i = 0; i < 8; i++) a.add({ x: 0.2, y: 0.3, dt: 0.5, tSec: 100 + i * 0.5, speed: 0.02, stationarySeconds: 0 });
    const b = bank.get("cam-b");
    expect(b.samples).toBe(0);
    expect(b.compute(60, 104, "occupancy").buckets).toBe(0);
    expect(bank.get("cam-a").samples).toBe(8);
  });

  it("uses normalized anchors, so camera resolution cannot shift activity", () => {
    const h = new HeatMap();
    h.add({ x: 0.25, y: 0.75, dt: 0.5, tSec: 100, speed: 0, stationarySeconds: 0 });
    const r = h.compute(10, 100, "occupancy");
    // anchor is 25% across / 75% down regardless of the camera pixel size
    expect(cellSum(r.grid, 0.15, 0.35)).toBeGreaterThan(0);
    expect(sum(r.grid)).toBeGreaterThan(0);
  });
});
