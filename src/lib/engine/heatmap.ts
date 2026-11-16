import type { Box } from "./types";
import type { HeatmapMode, Pt, Zone } from "@/lib/settings";
import { pointInPolygon } from "./geometry";

/**
 * Tracking-driven activity heat map.
 *
 * Every valid tracked sample contributes its person-centre anchor to three
 * per-second grids:
 *   occupancy — time spent at a position (seconds, Gaussian splat)
 *   movement  — displacement-weighted activity (fast movement counts more)
 *   dwell     — time spent nearly stationary, ramped in after a couple of seconds
 *
 * Positions are normalized 0..1 image coordinates, so resizing the camera view
 * cannot move activity. Only tracked samples are added; a lost track adds
 * nothing until it is re-associated.
 *
 * Old activity decays with a configurable exponential half-life. The grids are
 * people-activity density in image space. They are NOT thermal imaging and a
 * busy area is not automatically dangerous.
 */
export const GW = 72;
export const GH = 40;
export const MAX_SECONDS = 1800;

type Grids = { occupancy: Float32Array; movement: Float32Array; dwell: Float32Array };

const newGrids = (): Grids => ({
  occupancy: new Float32Array(GW * GH),
  movement: new Float32Array(GW * GH),
  dwell: new Float32Array(GW * GH),
});

const STILL_SPEED = 0.012; // normalized image units per second
const MOVEMENT_REF_SPEED = 0.18;

export type HeatSample = {
  x: number; // normalized person-centre anchor
  y: number;
  dt: number; // seconds since previous processed sample
  tSec: number;
  speed: number; // normalized units / second
  stationarySeconds: number;
};

export type HeatRenderStats = {
  empty: boolean;
  mode: HeatmapMode;
  peak: number;
  peakDwellSeconds: number;
  buckets: number;
  activeCells: number;
  samples: number;
  masked: boolean;
};

export class HeatMap {
  private ring: Grids[] = Array.from({ length: MAX_SECONDS }, newGrids);
  private stamps = new Int32Array(MAX_SECONDS).fill(-1);
  private mask: Uint8Array | null = null;
  private maskZones = 0;
  samples = 0;
  lastSampleAt = 0;
  startedAt = Date.now();
  cameraKey = "default";
  mode: HeatmapMode = "occupancy";

  reset() {
    this.stamps.fill(-1);
    this.samples = 0;
    this.lastSampleAt = 0;
    this.startedAt = Date.now();
  }

  /** Build a soft monitored-area mask from enabled zones. IGNORE zones subtract. */
  setMonitoredZones(zones: Zone[], enabled: boolean) {
    const monitored = zones.filter((z) => z.enabled && z.type !== "IGNORE" && z.points.length >= 3);
    const ignored = zones.filter((z) => z.enabled && z.type === "IGNORE" && z.points.length >= 3);
    if (!enabled || monitored.length === 0) {
      this.mask = null;
      this.maskZones = 0;
      return;
    }
    const m = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const p: Pt = { x: (x + 0.5) / GW, y: (y + 0.5) / GH };
        const inside = monitored.some((z) => pointInPolygon(p, z.points));
        const ignoredHere = ignored.some((z) => pointInPolygon(p, z.points));
        m[y * GW + x] = inside && !ignoredHere ? 1 : 0;
      }
    }
    this.mask = m;
    this.maskZones = monitored.length;
  }

  get masked() {
    return this.mask !== null;
  }

  add(s: HeatSample) {
    const dt = Math.min(1, Math.max(0, s.dt));
    if (!(dt > 0) || s.x < -0.05 || s.x > 1.05 || s.y < -0.05 || s.y > 1.05) return;
    const sec = Math.floor(s.tSec);
    const idx = ((sec % MAX_SECONDS) + MAX_SECONDS) % MAX_SECONDS;
    if (this.stamps[idx] !== sec) {
      this.ring[idx] = newGrids();
      this.stamps[idx] = sec;
    }
    const g = this.ring[idx];
    const wOcc = dt;
    const wMov = dt * Math.min(1, Math.max(0, s.speed) / MOVEMENT_REF_SPEED);
    const dwellRamp = s.speed <= STILL_SPEED ? Math.min(1, Math.max(0, s.stationarySeconds) / 2.5) : 0;
    const wDwell = dt * dwellRamp;
    splat(g.occupancy, s.x, s.y, wOcc);
    splat(g.movement, s.x, s.y, wMov);
    splat(g.dwell, s.x, s.y, wDwell);
    this.samples++;
    this.lastSampleAt = s.tSec;
  }

  /** Decayed grid for a window and mode. */
  compute(windowSec: number, nowSec: number, mode: HeatmapMode = this.mode, halfLifeSec = Math.max(10, windowSec / 2)) {
    const out = new Float32Array(GW * GH);
    const raw = mode === "dwell" ? new Float32Array(GW * GH) : null;
    const now = Math.floor(nowSec);
    let buckets = 0;
    let activeCells = 0;
    const ageWeight = (age: number) => Math.pow(0.5, age / halfLifeSec);
    for (let age = 0; age < windowSec; age++) {
      const sec = now - age;
      if (sec < 0) continue;
      const idx = ((sec % MAX_SECONDS) + MAX_SECONDS) % MAX_SECONDS;
      if (this.stamps[idx] !== sec) continue;
      buckets++;
      const wgt = ageWeight(age);
      const g = this.ring[idx][mode];
      for (let i = 0; i < g.length; i++) {
        const v = g[i];
        if (v === 0) continue;
        out[i] += v * wgt;
        if (raw) raw[i] += v;
      }
    }
    let peak = 0;
    let peakDwell = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] > 0) {
        if (this.mask && !this.mask[i]) {
          out[i] = 0;
          if (raw) raw[i] = 0;
          continue;
        }
        activeCells++;
        if (out[i] > peak) peak = out[i];
        if (raw && raw[i] > peakDwell) peakDwell = raw[i];
      }
    }
    if (mode !== "dwell") {
      // raw dwell is useful as a separate measured stat even when another mode is shown
      for (let age = 0; age < windowSec; age++) {
        const sec = now - age;
        if (sec < 0) continue;
        const idx = ((sec % MAX_SECONDS) + MAX_SECONDS) % MAX_SECONDS;
        if (this.stamps[idx] !== sec) continue;
        const g = this.ring[idx].dwell;
        for (let i = 0; i < g.length; i++) if (!this.mask || this.mask[i]) if (g[i] > peakDwell) peakDwell = g[i];
      }
    }
    return { grid: out, peak, peakDwellSeconds: peakDwell, buckets, activeCells, masked: this.mask !== null };
  }

  private cv: HTMLCanvasElement | null = null;

  /**
   * Draws the selected mode covering w×h. `opacity` is multiplied into alpha,
   * `intensity` scales against the busiest cell in the window.
   */
  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    windowSec: number,
    nowSec: number,
    intensity: number,
    opacity: number,
    mode: HeatmapMode = this.mode,
    halfLifeSec = Math.max(10, windowSec / 2),
  ): HeatRenderStats {
    const { grid, peak, peakDwellSeconds, buckets, activeCells } = this.compute(windowSec, nowSec, mode, halfLifeSec);
    const empty = buckets === 0 || peak <= 0;
    if (empty) {
      return { empty: true, mode, peak: 0, peakDwellSeconds, buckets, activeCells: 0, samples: this.samples, masked: this.mask !== null };
    }
    if (!this.cv) {
      this.cv = document.createElement("canvas");
      this.cv.width = GW;
      this.cv.height = GH;
    }
    const c = this.cv.getContext("2d")!;
    const img = c.createImageData(GW, GH);
    // Avoid exaggerating a tiny amount of activity but retain relative contrast.
    const ref = Math.max(peak, mode === "occupancy" ? 1.4 : 0.12);
    for (let i = 0; i < grid.length; i++) {
      const v = Math.min(1, (grid[i] / ref) * intensity);
      if (v <= 0.001) continue;
      const [r, g, b] = ramp(v, mode);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.min(255, Math.pow(v, 0.75) * 255 * opacity);
    }
    c.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.cv, 0, 0, w, h);
    ctx.restore();
    return { empty: false, mode, peak, peakDwellSeconds, buckets, activeCells, samples: this.samples, masked: this.mask !== null };
  }
}

function splat(grid: Float32Array, cx: number, cy: number, weight: number) {
  if (!(weight > 0)) return;
  const gx = cx * GW - 0.5;
  const gy = cy * GH - 0.5;
  const R = 4;
  const sigma = 1.55;
  for (let y = Math.floor(gy) - R; y <= Math.ceil(gy) + R; y++) {
    if (y < 0 || y >= GH) continue;
    for (let x = Math.floor(gx) - R; x <= Math.ceil(gx) + R; x++) {
      if (x < 0 || x >= GW) continue;
      const d2 = (x - gx) ** 2 + (y - gy) ** 2;
      grid[y * GW + x] += weight * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

// ABYSS ramps. Deliberately different per mode, still inside the sea palette.
const OCCUPANCY: [number, [number, number, number]][] = [
  [0, [19, 54, 50]],
  [0.25, [38, 120, 111]],
  [0.5, [121, 220, 196]],
  [0.72, [210, 232, 190]],
  [0.88, [230, 184, 108]],
  [1, [241, 120, 105]],
];
const MOVEMENT: [number, [number, number, number]][] = [
  [0, [13, 42, 46]],
  [0.3, [38, 96, 112]],
  [0.55, [88, 170, 188]],
  [0.78, [121, 220, 196]],
  [1, [241, 232, 188]],
];
const DWELL: [number, [number, number, number]][] = [
  [0, [22, 43, 38]],
  [0.3, [84, 122, 92]],
  [0.55, [166, 190, 132]],
  [0.8, [230, 184, 108]],
  [1, [241, 140, 105]],
];

function ramp(v: number, mode: HeatmapMode): [number, number, number] {
  const stops = mode === "movement" ? MOVEMENT : mode === "dwell" ? DWELL : OCCUPANCY;
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (v - a) / (b - a || 1);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export const HEAT_RAMP: Record<HeatmapMode, [number, [number, number, number]][]> = {
  occupancy: OCCUPANCY,
  movement: MOVEMENT,
  dwell: DWELL,
};

/** Keeps an independent heat map per camera device, so switching feeds never mixes activity. */
export class HeatMapBank {
  private maps = new Map<string, HeatMap>();
  activeKey = "default";
  constructor(private maxMaps = 4) {}
  get(key = this.activeKey): HeatMap {
    let m = this.maps.get(key);
    if (!m) {
      m = new HeatMap();
      m.cameraKey = key;
      m.mode = this.maps.get(this.activeKey)?.mode ?? "occupancy";
      this.maps.set(key, m);
      if (this.maps.size > this.maxMaps) {
        const oldest = this.maps.keys().next().value;
        if (oldest && oldest !== key) this.maps.delete(oldest);
      }
    }
    this.activeKey = key;
    return m;
  }
  reset(key?: string) {
    if (key) this.maps.get(key)?.reset();
    else this.maps.forEach((m) => m.reset());
  }
  keys() {
    return [...this.maps.keys()];
  }
  /** Remove inactive camera maps while keeping this session bounded. */
  prune(keep: string[]) {
    for (const k of this.maps.keys()) if (!keep.includes(k) && k !== this.activeKey) this.maps.delete(k);
  }
}

/** Convenience for evidence/render contexts that only have a track anchor. */
export function trackAnchor(box: Box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
