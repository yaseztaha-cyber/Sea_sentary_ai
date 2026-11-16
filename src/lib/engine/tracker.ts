import type { Detection, Track } from "./types";
import { iou } from "./geometry";
import type { Settings } from "@/lib/settings";

/**
 * ByteTrack-style multi-object tracker with optimal (Hungarian) IoU
 * association, two-stage high/low-confidence matching, constant-velocity
 * prediction and occlusion recovery. No appearance or face features are used;
 * track IDs are anonymous and local to the camera session.
 *
 * Time is always real elapsed time from the caller (performance clock captured
 * at the video frame callback), never a fixed assumed FPS. Motion gates,
 * smoothing and velocity are normalised per second, so a camera frame-rate
 * change cannot look like a swimmer accelerating.
 */

type Pair = { di: number; ti: number; v: number; cost: number };

const BIG = 1e6;

/** Minimum-cost rectangular assignment (Hungarian / Kuhn-Munkres). */
export function assignOptimal(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]?.length ?? 0;
  if (m === 0) return new Array(n).fill(-1);
  if (n === 1) {
    let best = 0;
    for (let j = 1; j < m; j++) if (cost[0][j] < cost[0][best]) best = j;
    return [best];
  }
  const size = Math.max(n, m);
  const a: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i < n && j < m ? cost[i][j] : BIG)),
  );
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0);
  const way = new Array(size + 1).fill(0);
  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(Infinity);
    const used = new Array(size + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const result = new Array(n).fill(-1);
  for (let j = 1; j <= size; j++) {
    const i = p[j];
    if (i >= 1 && i <= n && j <= m) result[i - 1] = j - 1;
  }
  return result;
}

export class Tracker {
  tracks: Track[] = [];
  private nextId = 1;
  constructor(
    public cfg: Settings["tracking"],
    public highScore: number,
  ) {}

  configure(cfg: Settings["tracking"], highScore: number) {
    this.cfg = cfg;
    this.highScore = highScore;
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  private predicted(tr: Track, t: number) {
    const dt = Math.min(this.cfg.maxPredictSeconds ?? 2.5, Math.max(0, t - tr.lastT));
    const decay = tr.state === "lost" ? Math.pow(0.55, Math.min(dt, 2.5)) : 1;
    const x = Math.min(1 - tr.box.w, Math.max(0, tr.box.x + tr.vx * dt * decay));
    const y = Math.min(1 - tr.box.h, Math.max(0, tr.box.y + tr.vy * dt * decay));
    return { x, y, w: tr.box.w, h: tr.box.h };
  }

  /** Builds gated candidate pairs and solves the assignment. */
  private associate(dets: Detection[], tracks: Track[], t: number, thr: number, includeLost: boolean) {
    if (!dets.length || !tracks.length) {
      return { matches: [] as [Detection, Track][], restDets: dets, restTracks: tracks };
    }
    const pairs: Pair[][] = dets.map(() => []);
    dets.forEach((d, di) => {
      tracks.forEach((tr, ti) => {
        if (tr.state === "lost" && !includeLost) return;
        const pb = this.predicted(tr, t);
        const dt = Math.max(0.03, t - tr.lastT);
        const dCx = d.box.x + d.box.w / 2;
        const dCy = d.box.y + d.box.h / 2;
        const pCx = pb.x + pb.w / 2;
        const pCy = pb.y + pb.h / 2;
        const centerDist = Math.hypot(dCx - pCx, dCy - pCy);
        const lost = tr.state === "lost";
        const sizeRatio = (d.box.w * d.box.h) / Math.max(1e-6, pb.w * pb.h);
        if (sizeRatio < this.cfg.sizeGateMin || sizeRatio > this.cfg.sizeGateMax) return;
        // The search radius grows with elapsed time (occlusion uncertainty) but
        // is capped, so a lost track cannot jump across the frame.
        const uncertainty = Math.min(dt, this.cfg.maxLostSeconds) * 0.06 * (this.cfg.lostRecoveryGrowth ?? 1);
        const maxJump =
          this.cfg.maxJumpPerSecond * Math.max(dt, 0.12) * (lost ? 1.35 : 1) +
          0.1 * Math.max(pb.w, pb.h) +
          (lost ? uncertainty : 0);
        if (centerDist > maxJump) return;
        let v = iou(d.box, pb);
        if (v < thr) {
          // Centre-distance fallback for fast swimmers and temporarily missed
          // boxes. It is deliberately stricter than the IoU path.
          const cd = centerDist / Math.max(pb.h, 0.05);
          const fallbackDist = lost ? 0.62 : 0.48;
          if (cd >= fallbackDist) return;
          v = thr + (fallbackDist - cd) * 0.18;
        }
        if (v < thr) return;
        // Penalise centre motion and size change; lost tracks pay a small
        // recovery cost so a visible live detection is preferred.
        const cost = 1 - v + 0.16 * Math.min(1, centerDist) + 0.04 * Math.abs(Math.log(sizeRatio)) + (lost ? 0.07 : 0);
        pairs[di].push({ di, ti, v, cost });
      });
    });
    const matrix = pairs.map((row) => {
      const line = new Array<number>(tracks.length).fill(BIG);
      for (const p of row) line[p.ti] = p.cost;
      return line;
    });
    const assignment = assignOptimal(matrix);
    const usedD = new Set<number>();
    const usedT = new Set<number>();
    const matches: [Detection, Track][] = [];
    assignment.forEach((ti, di) => {
      if (ti < 0 || ti >= tracks.length) return;
      const p = pairs[di].find((x) => x.ti === ti);
      if (!p || p.v < thr) return;
      if (usedD.has(di) || usedT.has(ti)) return;
      usedD.add(di);
      usedT.add(ti);
      matches.push([dets[di], tracks[ti]]);
    });
    return {
      matches,
      restDets: dets.filter((_, i) => !usedD.has(i)),
      restTracks: tracks.filter((_, i) => !usedT.has(i)),
    };
  }

  private apply(tr: Track, d: Detection, t: number) {
    const rawCx = d.box.x + d.box.w / 2;
    const rawCy = d.box.y + d.box.h / 2;
    const prev = tr.history[tr.history.length - 1];
    const wasLost = tr.state === "lost";
    const dt = prev ? Math.max(0.03, t - prev.t) : 0.15;
    let stepSpeed = 0;
    if (prev) {
      const dx = rawCx - prev.cx;
      const dy = rawCy - prev.cy;
      stepSpeed = Math.hypot(dx, dy) / dt;
      const alpha = 1 - Math.exp(-dt / Math.max(0.05, this.cfg.smoothingTau));
      tr.vx = tr.vx * (1 - alpha) + (dx / dt) * alpha;
      tr.vy = tr.vy * (1 - alpha) + (dy / dt) * alpha;
      const speedV = Math.hypot(tr.vx, tr.vy);
      const vmax = this.cfg.maxJumpPerSecond * 1.2;
      if (speedV > vmax) {
        tr.vx = (tr.vx / speedV) * vmax;
        tr.vy = (tr.vy / speedV) * vmax;
      }
      // A gap longer than ~2 missed ticks is a re-acquisition, not continuous
      // motion. Keep the gap explicit so trails and heat maps do not bridge it.
      if (t - prev.t <= 0.75) tr.stationarySeconds = stepSpeed < 0.012 ? tr.stationarySeconds + dt : 0;
      else tr.stationarySeconds = 0;
    }
    if (tr.state === "lost" && tr.lostSince !== null) {
      const gapSeconds = t - tr.lostSince;
      tr.gaps.push(gapSeconds);
      tr.gapEvents.push({ t, seconds: gapSeconds });
      tr.reacquisitions++;
      if (tr.gaps.length > 40) tr.gaps.splice(0, tr.gaps.length - 40);
      if (tr.gapEvents.length > 40) tr.gapEvents.splice(0, tr.gapEvents.length - 40);
    }
    // Position/box smoothing (time-aware). The raw detection remains available
    // as lastDetScore; smoothing reduces overlay jitter and ID switching on
    // low-resolution frames without inventing a new person.
    const pt = this.cfg.positionSmoothing ?? 0.18;
    const pAlpha = prev ? 1 - Math.exp(-dt / Math.max(0.05, pt)) : 1;
    const sx = prev ? prev.cx + (rawCx - prev.cx) * pAlpha : rawCx;
    const sy = prev ? prev.cy + (rawCy - prev.cy) * pAlpha : rawCy;
    const sw = prev ? prev.w + (d.box.w - prev.w) * pAlpha : d.box.w;
    const sh = prev ? prev.h + (d.box.h - prev.h) * pAlpha : d.box.h;
    tr.box = { x: sx - sw / 2, y: sy - sh / 2, w: sw, h: sh };
    tr.lastT = t;
    tr.lostSince = null;
    tr.misses = 0;
    tr.consecutiveMisses = 0;
    tr.consecutiveHits = (tr.consecutiveHits ?? 0) + 1;
    tr.hits++;
    tr.score = tr.score * 0.7 + d.score * 0.3;
    tr.lastDetScore = d.score;
    tr.speed = prev ? (t - prev.t <= 0.75 ? stepSpeed : 0) : 0;
    if (tr.hits >= this.cfg.minHits && ((tr.consecutiveHits ?? 0) >= (this.cfg.confirmationHits ?? 2) || wasLost)) {
      if (tr.state !== "tracked") tr.confirmedAt = t;
      tr.state = "tracked";
    } else {
      tr.state = "tentative";
    }
    tr.history.push({ t, cx: sx, cy: sy, w: sw, h: sh, score: d.score });
    if (tr.history.length > 600) tr.history.splice(0, tr.history.length - 600);
  }

  /** Returns tracks that expired during this update (confirmed tracks only). */
  update(dets: Detection[], t: number): { expired: Track[]; created: Track[] } {
    const high = dets.filter((d) => d.score >= this.highScore);
    const low = dets.filter((d) => d.score < this.highScore && d.score >= (this.cfg.lowScore ?? 0.18));
    const thr = this.cfg.iouThreshold;

    const s1 = this.associate(high, this.tracks, t, thr, true);
    s1.matches.forEach(([d, tr]) => this.apply(tr, d, t));
    const s2 = this.associate(
      low,
      s1.restTracks.filter((tr) => tr.state !== "lost"),
      t,
      Math.max(0.3, thr),
      false,
    );
    s2.matches.forEach(([d, tr]) => this.apply(tr, d, t));
    const matched2 = new Set(s2.matches.map(([, tr]) => tr));
    const unmatched = s1.restTracks.filter((tr) => !matched2.has(tr));

    const expired: Track[] = [];
    const lostAfter = Math.max(1, this.cfg.lostAfterMisses ?? 2);
    for (const tr of unmatched) {
      tr.misses++;
      tr.totalMisses++;
      tr.consecutiveHits = 0;
      tr.consecutiveMisses = (tr.consecutiveMisses ?? 0) + 1;
      if (tr.state === "tentative") {
        if (tr.consecutiveMisses > 1) tr.state = "lost";
        else continue;
      } else if (tr.state === "tracked" && tr.consecutiveMisses >= lostAfter) {
        tr.state = "lost";
      }
      if (tr.state === "lost" && tr.lostSince === null) tr.lostSince = tr.lastT;
      // Decay velocity while occluded: prediction must not fling a lost track
      // across the frame.
      tr.vx *= 0.82;
      tr.vy *= 0.82;
    }
    this.tracks = this.tracks.filter((tr) => {
      if (tr.state === "lost" && tr.lostSince !== null && t - tr.lostSince > this.cfg.maxLostSeconds) {
        if (tr.hits >= this.cfg.minHits) expired.push(tr);
        return false;
      }
      return true;
    });

    const created: Track[] = [];
    for (const d of s1.restDets) {
      // Do not create a duplicate fragment on top of an existing track. The
      // centre test includes recently lost tracks so a person who was briefly
      // occluded is recovered instead of split into a new identity.
      const duplicate = this.tracks.some((tr) => {
        const pb = this.predicted(tr, t);
        if (iou(d.box, pb) >= (this.cfg.duplicateIou ?? 0.55)) return true;
        const dc = Math.hypot(d.box.x + d.box.w / 2 - (pb.x + pb.w / 2), d.box.y + d.box.h / 2 - (pb.y + pb.h / 2));
        const recentLost = tr.state === "lost" && tr.lostSince !== null && t - tr.lostSince <= 2;
        const radius = (recentLost ? 0.5 : 0.35) * Math.max(tr.box.h, d.box.h);
        return dc < radius && (tr.state !== "lost" || recentLost);
      });
      if (duplicate) continue;
      const cx = d.box.x + d.box.w / 2;
      const cy = d.box.y + d.box.h / 2;
      const tr: Track = {
        id: this.nextId++,
        box: d.box,
        state: this.cfg.minHits <= 1 ? "tracked" : "tentative",
        firstT: t,
        lastT: t,
        lostSince: null,
        hits: 1,
        misses: 0,
        totalMisses: 0,
        gaps: [],
        gapEvents: [],
        vx: 0,
        vy: 0,
        score: d.score,
        lastDetScore: d.score,
        history: [{ t, cx, cy, w: d.box.w, h: d.box.h, score: d.score }],
        stationarySeconds: 0,
        speed: 0,
        reacquisitions: 0,
        consecutiveHits: 1,
        consecutiveMisses: 0,
      };
      this.tracks.push(tr);
      created.push(tr);
    }
    return { expired, created };
  }

  confirmed(): Track[] {
    return this.tracks.filter((t) => t.hits >= this.cfg.minHits && t.state !== "tentative");
  }
  active(): Track[] {
    return this.tracks.filter((t) => t.state === "tracked");
  }
}

export function trackQuality(t: Track): number {
  const total = t.hits + t.totalMisses;
  const continuity = total === 0 ? 0 : t.hits / total;
  const confirmation = t.hits >= 3 ? 1 : t.hits / 3;
  return continuity * confirmation * t.score;
}
