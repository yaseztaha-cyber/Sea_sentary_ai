import type { Track } from "./types";
import type { Observation, Settings, Zone } from "@/lib/settings";
import { RULE_VERSION } from "@/lib/settings";
import { pointInPolygon } from "./geometry";

/**
 * EXPERIMENTAL — HUMAN REVIEW REQUIRED.
 * Transparent, rule-based temporal screening over real track features, using real timestamps.
 * It is NOT a validated drowning detector. It has not been tested on representative water footage.
 * Missing observations, floating, resting, diving or inactivity alone are never treated as an emergency.
 * A future independently validated water-specific distress classifier can plug in behind `BehaviorAnalyzer`.
 */
export interface BehaviorAnalyzer {
  version: string;
  evaluate(input: EvalInput): Observation[];
}

export type EvalInput = {
  tracks: Track[];
  expired: Track[];
  zones: Zone[];
  settings: Settings;
  now: number; // performance seconds
  wallClock: () => string;
};

export type TrackFeatures = {
  windowSeconds: number;
  samples: number;
  pathLength: number;
  netDisplacement: number;
  tortuosity: number;
  reversals: number;
  interruptions: number;
  stalledSeconds: number;
  meanSpeed: number;
  aspectStd: number;
  ageSeconds: number;
};

export type TrackLevel = { level: 1 | 2 | 3; kind: string | null; until: number };

export function computeFeatures(tr: Track, now: number, windowSeconds: number): TrackFeatures {
  const pts = tr.history.filter((p) => now - p.t <= windowSeconds);
  let path = 0;
  let reversals = 0;
  let interruptions = 0;
  let stalled = 0;
  let wasMoving = false;
  let prevHeading: number | null = null;
  const STILL = 0.006; // normalized units per second
  const aspects: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    aspects.push(pts[i].h / Math.max(0.001, pts[i].w));
    if (i === 0) continue;
    const dt = Math.max(0.03, pts[i].t - pts[i - 1].t);
    const dx = pts[i].cx - pts[i - 1].cx;
    const dy = pts[i].cy - pts[i - 1].cy;
    const step = Math.hypot(dx, dy);
    path += step;
    const speed = step / dt;
    if (speed < STILL) {
      stalled += dt;
      if (wasMoving) interruptions++;
      wasMoving = false;
    } else {
      wasMoving = true;
    }
    if (step > 0.008) {
      const heading = Math.atan2(dy, dx);
      if (prevHeading !== null) {
        let d = Math.abs(heading - prevHeading);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > (2 * Math.PI) / 3) reversals++;
      }
      prevHeading = heading;
    }
  }
  const net = pts.length > 1 ? Math.hypot(pts[pts.length - 1].cx - pts[0].cx, pts[pts.length - 1].cy - pts[0].cy) : 0;
  const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
  const mean = aspects.length ? aspects.reduce((a, b) => a + b, 0) / aspects.length : 0;
  const std = aspects.length ? Math.sqrt(aspects.reduce((a, b) => a + (b - mean) ** 2, 0) / aspects.length) / Math.max(0.001, mean) : 0;
  return {
    windowSeconds: span,
    samples: pts.length,
    pathLength: path,
    netDisplacement: net,
    tortuosity: path / Math.max(net, 0.02),
    reversals,
    interruptions,
    stalledSeconds: stalled,
    meanSpeed: span > 0 ? path / span : 0,
    aspectStd: std,
    ageSeconds: now - tr.firstT,
  };
}

const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export class RuleBasedAnalyzer implements BehaviorAnalyzer {
  version = RULE_VERSION;
  private cooldown = new Map<string, number>();
  levels = new Map<number, TrackLevel>();

  reset() {
    this.cooldown.clear();
    this.levels.clear();
  }

  private zoneOf(tr: Track, zones: Zone[]): Zone[] {
    const c = { x: tr.box.x + tr.box.w / 2, y: tr.box.y + tr.box.h / 2 };
    return zones.filter((z) => z.enabled && pointInPolygon(c, z.points));
  }

  private ready(key: string, now: number, cool = 25) {
    const last = this.cooldown.get(key);
    if (last !== undefined && now - last < cool) return false;
    this.cooldown.set(key, now);
    return true;
  }

  evaluate({ tracks, expired, zones, settings, now, wallClock }: EvalInput): Observation[] {
    const b = settings.behavior;
    const out: Observation[] = [];
    if (!b.enabled) {
      this.levels.clear();
      return out;
    }
    const mk = (tr: Track, level: 2 | 3, kind: string, summary: string, f: TrackFeatures, zone: string | null, reached: string[], extra: Record<string, number | string> = {}, duration = f.windowSeconds): Observation => ({
      at: wallClock(),
      level,
      kind,
      trackId: tr.id,
      zone,
      durationSeconds: r(duration, 1),
      summary,
      features: {
        pathLength: r(f.pathLength),
        netDisplacement: r(f.netDisplacement),
        tortuosity: r(f.tortuosity, 2),
        directionReversals: f.reversals,
        movementInterruptions: f.interruptions,
        stalledSeconds: r(f.stalledSeconds, 1),
        meanSpeed: r(f.meanSpeed, 4),
        boundingBoxAspectVariation: r(f.aspectStd, 2),
        trackAgeSeconds: r(f.ageSeconds, 1),
        samples: f.samples,
        ...extra,
      },
      thresholds: {
        reversalCount: b.reversalCount,
        tortuosity: b.tortuosity,
        stallSeconds: b.stallSeconds,
        disappearanceSeconds: b.disappearanceSeconds,
        minTrackSeconds: b.minTrackSeconds,
        windowSeconds: b.windowSeconds,
      },
      reached,
      ruleVersion: RULE_VERSION,
    });

    const alive = new Set<number>();
    for (const tr of tracks) {
      if (tr.hits < settings.tracking.minHits) continue;
      alive.add(tr.id);
      const zs = this.zoneOf(tr, zones);
      if (zs.some((z) => z.type === "IGNORE")) {
        this.levels.set(tr.id, { level: 1, kind: null, until: now });
        continue;
      }
      const water = zs.find((z) => z.type === "SWIMMING" || z.type === "RESTRICTED") ?? null;
      const f = computeFeatures(tr, now, b.windowSeconds);
      const old = f.ageSeconds >= b.minTrackSeconds;
      const erratic = f.reversals >= b.reversalCount || (f.tortuosity >= b.tortuosity && f.pathLength > 0.12);
      const stalling = f.interruptions >= 2 && f.stalledSeconds >= b.stallSeconds;
      const aspectUnstable = f.aspectStd > 0.3;

      let level: 1 | 2 | 3 = 1;
      let kind: string | null = null;
      if (tr.state === "tracked" && old && f.samples >= 8) {
        const indicators: string[] = [];
        if (erratic) indicators.push(`erratic trajectory (reversals ${f.reversals}/${b.reversalCount}, tortuosity ${r(f.tortuosity, 1)}/${b.tortuosity})`);
        if (stalling) indicators.push(`repeated movement interruptions (${f.interruptions}, stalled ${r(f.stalledSeconds, 1)}s/${b.stallSeconds}s)`);
        if (aspectUnstable) indicators.push(`bounding-box shape variation ${r(f.aspectStd, 2)}`);
        if (water && indicators.length >= 2 && (erratic || stalling)) {
          level = 3;
          kind = "Potential distress indicators";
          if (this.ready(`${tr.id}:L3`, now)) {
            out.push(mk(tr, 3, kind, `Track #${tr.id} in ${water.type.toLowerCase()} zone “${water.name}” shows ${indicators.length} combined indicators: ${indicators.join("; ")}. Experimental screening — human review required.`, f, water.name, indicators));
          }
        } else if (erratic) {
          level = 2;
          kind = "Unusual movement";
          if (this.ready(`${tr.id}:L2`, now)) {
            out.push(mk(tr, 2, kind, `Track #${tr.id} shows unusual movement: ${indicators[0]}.`, f, water?.name ?? zs[0]?.name ?? null, indicators));
          }
        }
      }
      if (zs.some((z) => z.type === "RESTRICTED") && tr.state === "tracked" && now - tr.firstT > 2) {
        if (level < 2) {
          level = 2;
          kind = "Presence in restricted zone";
        }
        const z = zs.find((x) => x.type === "RESTRICTED")!;
        if (this.ready(`${tr.id}:RZ`, now, 60)) {
          out.push(mk(tr, 2, "Presence in restricted zone", `Track #${tr.id} is inside restricted zone “${z.name}”. Presence alone is not an emergency.`, f, z.name, ["inside restricted zone"]));
        }
      }
      this.levels.set(tr.id, { level, kind, until: now });
    }

    // Disappearance inside a water zone (lost tracks and expired tracks).
    const check = (tr: Track, gone: number) => {
      const last = tr.history[tr.history.length - 1];
      if (!last || gone < b.disappearanceSeconds) return;
      const zs = zones.filter((z) => z.enabled && (z.type === "SWIMMING" || z.type === "RESTRICTED") && pointInPolygon({ x: last.cx, y: last.cy }, z.points));
      if (!zs.length || zones.some((z) => z.enabled && z.type === "IGNORE" && pointInPolygon({ x: last.cx, y: last.cy }, z.points))) return;
      const f = computeFeatures(tr, tr.lastT, b.windowSeconds);
      if (f.ageSeconds < b.minTrackSeconds) return;
      // Near the frame edge a person most likely left the view — not a disappearance.
      if (last.cx < 0.04 || last.cx > 0.96 || last.cy < 0.04 || last.cy > 0.96) return;
      const prior = f.reversals >= b.reversalCount || f.tortuosity >= b.tortuosity || (f.interruptions >= 2 && f.stalledSeconds >= b.stallSeconds);
      if (!this.ready(`${tr.id}:GONE`, now, 60)) return;
      const reached = [`track not observed for ${r(gone, 1)}s (threshold ${b.disappearanceSeconds}s) inside ${zs[0].type.toLowerCase()} zone, away from frame edge`];
      if (prior) {
        reached.push("preceding unusual movement in the analysis window");
        out.push(mk(tr, 3, "Potential distress indicators", `Track #${tr.id} was last seen in “${zs[0].name}” after unusual movement and has not been observed for ${r(gone, 1)}s. A missing track can mean diving, occlusion or a detector miss — human review required.`, f, zs[0].name, reached, { secondsUnobserved: r(gone, 1) }, gone));
      } else {
        out.push(mk(tr, 2, "Track disappearance in water zone", `Track #${tr.id} was last seen in “${zs[0].name}” and has not been observed for ${r(gone, 1)}s. Disappearance alone is not evidence of distress.`, f, zs[0].name, reached, { secondsUnobserved: r(gone, 1) }, gone));
      }
    };
    for (const tr of tracks) if (tr.state === "lost" && tr.lostSince !== null && tr.hits >= settings.tracking.minHits) check(tr, now - tr.lostSince);
    for (const tr of expired) check(tr, (tr.lostSince !== null ? now - tr.lostSince : 0));

    for (const id of [...this.levels.keys()]) if (!alive.has(id)) this.levels.delete(id);
    return out;
  }
}
