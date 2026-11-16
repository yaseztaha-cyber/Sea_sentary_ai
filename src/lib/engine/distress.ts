import type { DistressAssessment, DistressIndicator, EvidenceQuality, FrameQuality, Observation, RiskLevel, Settings, Zone, ZoneType } from "@/lib/settings";
import { DEFAULT_ZONE_CAPS, RULE_VERSION, RISK_LABEL, riskToLevel } from "@/lib/settings";
import type { Track } from "./types";
import type { Pt } from "@/lib/settings";
import { pointInPolygon } from "./geometry";

/**
 * Stage B — temporal swimmer-distress screening.
 *
 * This is an explainable, heuristic temporal baseline over real tracker output.
 * It is explicitly NOT a validated drowning detector and NOT a trained or
 * calibrated model: the thresholds are engineering defaults, not selected on a
 * licensed, representative water dataset. `score` is a weighted heuristic and
 * is never presented as a probability. `modelConfidence` stays null.
 *
 * Decision rules:
 *  - A single vertical posture, a stationary person or a lost track can never
 *    create a critical assessment.
 *  - A critical decision needs several independent indicator families, strong
 *    evidence quality, a configured water zone, and persistence over time.
 *  - Gaps are treated as possible submersion only when the camera's zone is
 *    marked as able to observe submersion and the gap is inside a plausible
 *    range; a gap can also be occlusion or an intentional dive.
 *  - Tracks outside configured water are never escalated on water-distress
 *    evidence.
 *  - Operator acknowledgment is an explicit state: it silences alerts but does
 *    not resolve the incident and never pretends the risk disappeared.
 */

export type TrackFeatures = {
  windowSeconds: number;
  samples: number;
  pathLength: number;
  netDisplacement: number;
  tortuosity: number;
  reversals: number;
  stalledSeconds: number;
  lowSpeedSeconds: number;
  meanSpeed: number;
  recentSpeed: number;
  priorSpeed: number;
  speedRatio: number;
  medianAspect: number;
  aspectStd: number;
  submersionEvents: number;
  longestSubmersion: number;
  gapSeconds: number;
  lossRecoveries: number;
  stationarySeconds: number;
  ageSeconds: number;
  edgeDistance: number;
};

export type AssessInput = {
  tracks: Track[];
  zones: Zone[];
  settings: Settings;
  now: number;
  wallClock: () => string;
  camera: string;
  frameQuality?: FrameQuality;
  /** Track IDs whose incident has been acknowledged by an operator. */
  acknowledgedTracks?: Set<number>;
};

export type DecisionState = "NORMAL" | "WATCH" | "SUSPECTED" | "CRITICAL" | "INSUFFICIENT_VISIBILITY" | "OPERATOR_ACKNOWLEDGED";

type State = {
  candidate: RiskLevel;
  candidateSince: number;
  level: RiskLevel;
  levelSince: number;
  lastEmit: Partial<Record<RiskLevel, number>>;
  lastEmittedLevel: RiskLevel | null;
  lastSeen: number;
  zone: string | null;
  lastAssessment: DistressAssessment | null;
  lastIndicators: DistressIndicator[];
  incidentCount: number;
};

export type TrackLevel = { level: 1 | 2 | 3 | 4; kind: string | null; until: number };

const STILL_STEP = 0.008;
const MIN_STEP = 0.004;
const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const LEVEL_RANK: Record<RiskLevel, number> = {
  NORMAL: 0,
  INSUFFICIENT_VISIBILITY: 0,
  UNCERTAIN: 1,
  OPERATOR_ACKNOWLEDGED: 2,
  WATCH: 2,
  SUSPECTED: 3,
  CRITICAL: 4,
};

const INDICATOR_WEIGHT = {
  submersion: 0.34,
  struggle: 0.22,
  vertical: 0.16,
  immobility: 0.12,
  noProgress: 0.1,
  suddenChange: 0.06,
  restrictedZone: 0.08,
  lossRecovery: 0.05,
} as const;

const INDICATOR_FAMILY: Record<string, string> = {
  submersion: "submersion",
  lossRecovery: "submersion",
  struggle: "movement",
  suddenChange: "movement",
  noProgress: "movement",
  immobility: "stillness",
  vertical: "posture",
  restrictedZone: "zone",
};

function distanceToPolygon(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / Math.max(1e-9, abx * abx + aby * aby)));
    const dx = p.x - (a.x + abx * t);
    const dy = p.y - (a.y + aby * t);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return Number.isFinite(best) ? best : 0;
}

function evidenceQuality(tr: Track, f: TrackFeatures, fq: FrameQuality | undefined, cfg: Settings["distress"], zoneCaps: { postureObservable: boolean; waterlineObservable: boolean; submersionObservable: boolean }): EvidenceQuality {
  const detectionConfidence = tr.lastDetScore || tr.score;
  const scoreNorm = clamp01((detectionConfidence - 0.25) / 0.6);
  const boxHeight = tr.history.length ? [...tr.history.slice(-10)].map((p) => p.h).sort((a, b) => a - b)[Math.floor(Math.min(10, tr.history.length) / 2)] : tr.box.h;
  const sizeNorm = clamp01((boxHeight - 0.02) / 0.16);
  const sampleNorm = clamp01(f.samples / Math.max(5, cfg.windowSeconds * 3));
  const luma = fq?.luma ?? 128;
  const contrast = fq?.contrast ?? 40;
  const lumaNorm = clamp01((luma - cfg.visibilityMinLuma) / 90);
  const contrastNorm = clamp01((contrast - cfg.visibilityMinContrast) / 70);
  const gapPenalty = clamp01(f.gapSeconds / 4) * 0.25;
  const score = clamp01(scoreNorm * 0.32 + sizeNorm * 0.24 + sampleNorm * 0.18 + lumaNorm * 0.15 + contrastNorm * 0.11 - gapPenalty);
  const reasons: string[] = [];
  if (detectionConfidence < cfg.visibilityMinScore) reasons.push(`detector confidence ${detectionConfidence.toFixed(2)} below ${cfg.visibilityMinScore}`);
  if (boxHeight < cfg.visibilityMinBoxHeight) reasons.push(`person box height ${boxHeight.toFixed(3)} below ${cfg.visibilityMinBoxHeight}`);
  if (f.samples < cfg.visibilityMinSamples) reasons.push(`only ${f.samples} samples`);
  if (fq && fq.luma < cfg.visibilityMinLuma) reasons.push(`frame luma ${fq.luma.toFixed(0)} below ${cfg.visibilityMinLuma}`);
  if (fq && fq.contrast < cfg.visibilityMinContrast) reasons.push(`frame contrast ${fq.contrast.toFixed(0)} below ${cfg.visibilityMinContrast}`);
  if (f.edgeDistance > 0 && f.edgeDistance < cfg.zoneEdgeMargin) reasons.push(`track is ${f.edgeDistance.toFixed(3)} from the water-zone edge (zone boundary ambiguity)`);
  if (!zoneCaps.postureObservable) reasons.push("zone is marked as unable to observe body posture");
  if (!zoneCaps.submersionObservable) reasons.push("zone is marked as unable to distinguish submersion from occlusion");
  const level = score >= 0.58 && reasons.length === 0 ? "GOOD" : score >= 0.4 ? "LIMITED" : "INSUFFICIENT";
  if (reasons.length === 0 && level !== "GOOD") reasons.push("combined evidence quality below good threshold");
  return {
    level,
    score: r(score, 2),
    reasons,
    frameLuma: fq ? r(fq.luma, 0) : null,
    frameContrast: fq ? r(fq.contrast, 0) : null,
    detectionConfidence: r(detectionConfidence, 2),
    boxHeight: r(boxHeight, 3),
    samples: f.samples,
    gapSeconds: r(f.gapSeconds, 1),
  };
}

export function computeTrackFeatures(tr: Track, now: number, windowSeconds: number, contextSeconds: number, cfg: Settings["distress"], zonePoly?: Pt[]): TrackFeatures {
  // +0.2 s tolerance includes the sample at the window boundary; floating
  // timestamps otherwise make the first sample flicker in and out and change
  // net displacement between consecutive assessments.
  const pts = tr.history.filter((p) => p.t <= now && now - p.t <= windowSeconds + 0.2);
  const prior = tr.history.filter((p) => p.t <= now && now - p.t > windowSeconds + 0.2 && now - p.t <= contextSeconds);
  let path = 0;
  let reversals = 0;
  let stalled = 0;
  let lowSpeed = 0;
  let prevHeading: number | null = null;
  const aspects: number[] = [];
  if (pts.length) {
    for (let i = 0; i < pts.length; i++) {
      aspects.push(pts[i].h / Math.max(0.001, pts[i].w));
      if (i === 0) continue;
      const prev = pts[i - 1];
      const dt = Math.max(0.03, pts[i].t - prev.t);
      const dx = pts[i].cx - prev.cx;
      const dy = pts[i].cy - prev.cy;
      const step = Math.hypot(dx, dy);
      path += step;
      const speed = step / dt;
      if (speed < cfg.immobilitySpeed) lowSpeed += dt;
      if (speed < STILL_STEP) stalled += dt;
      if (step > MIN_STEP) {
        const heading = Math.atan2(dy, dx);
        if (prevHeading !== null) {
          let d = Math.abs(heading - prevHeading);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > (2 * Math.PI) / 3) reversals++;
        }
        prevHeading = heading;
      }
    }
  }
  const net = pts.length > 1 ? Math.hypot(pts[pts.length - 1].cx - pts[0].cx, pts[pts.length - 1].cy - pts[0].cy) : 0;
  const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
  const meanSpeed = span > 0 ? path / span : 0;
  const aspectMean = aspects.length ? aspects.reduce((a, b) => a + b, 0) / aspects.length : 0;
  const aspectStd = aspects.length ? Math.sqrt(aspects.reduce((a, b) => a + (b - aspectMean) ** 2, 0) / aspects.length) : 0;
  const sortedAspect = aspects.slice().sort((a, b) => a - b);
  const medianAspect = sortedAspect.length ? sortedAspect[Math.floor(sortedAspect.length / 2)] : 0;

  const priorPath = prior.reduce((sum, p, i) => (i ? sum + Math.hypot(p.cx - prior[i - 1].cx, p.cy - prior[i - 1].cy) : 0), 0);
  const priorSpan = prior.length > 1 ? prior[prior.length - 1].t - prior[0].t : 0;
  const priorSpeed = priorSpan > 0 ? priorPath / priorSpan : 0;
  const recent = pts.slice(-Math.max(3, Math.ceil(pts.length / 2)));
  const recentPath = recent.reduce((sum, p, i) => (i ? sum + Math.hypot(p.cx - recent[i - 1].cx, p.cy - recent[i - 1].cy) : 0), 0);
  const recentSpan = recent.length > 1 ? recent[recent.length - 1].t - recent[0].t : 0;
  const recentSpeed = recentSpan > 0 ? recentPath / recentSpan : 0;
  const speedRatio = priorSpeed > 0.01 ? recentSpeed / priorSpeed : 1;

  const recentGaps = tr.gapEvents.filter((g) => g.t <= now && now - g.t <= contextSeconds);
  // A gap is only a candidate submersion when it is long enough to matter but
  // short enough to be a plausible re-surfacing; very long absences are handled
  // as track loss, not as a confirmed submersion.
  const gapEvents = recentGaps.filter((g) => g.seconds >= cfg.submersionGapSeconds && g.seconds <= cfg.maxSubmersionSeconds);
  const lossRecoveries = recentGaps.filter((g) => g.seconds >= 1).length;
  const anchor = pts.length ? pts[pts.length - 1] : tr.history[tr.history.length - 1];
  const edgeDistance = zonePoly && anchor ? distanceToPolygon({ x: anchor.cx, y: anchor.cy }, zonePoly) : Number.POSITIVE_INFINITY;
  return {
    windowSeconds: span,
    samples: pts.length,
    pathLength: path,
    netDisplacement: net,
    tortuosity: path / Math.max(net, 0.02),
    reversals,
    stalledSeconds: stalled,
    lowSpeedSeconds: lowSpeed,
    meanSpeed,
    recentSpeed,
    priorSpeed,
    speedRatio,
    medianAspect,
    aspectStd,
    submersionEvents: gapEvents.length,
    longestSubmersion: gapEvents.reduce((m, g) => Math.max(m, g.seconds), 0),
    gapSeconds: recentGaps.reduce((sum, g) => sum + g.seconds, 0),
    lossRecoveries,
    stationarySeconds: Math.max(tr.stationarySeconds, 0),
    ageSeconds: now - tr.firstT,
    edgeDistance,
  };
}

function zoneOfAnchor(anchor: Pt, zones: Zone[]): { zone: Zone | null; zoneType: ZoneType | null; ignored: boolean; anyWater: boolean } {
  const hits = zones.filter((z) => z.enabled && z.points.length >= 3 && pointInPolygon(anchor, z.points));
  if (hits.some((z) => z.type === "IGNORE")) return { zone: null, zoneType: "IGNORE", ignored: true, anyWater: false };
  const water = hits.find((z) => z.type === "SWIMMING") ?? hits.find((z) => z.type === "RESTRICTED");
  const z = water ?? hits.find((z) => z.type === "OBSERVATION") ?? null;
  return { zone: z, zoneType: z?.type ?? null, ignored: false, anyWater: !!water };
}

function mergeCaps(z: Zone) {
  return { ...DEFAULT_ZONE_CAPS, ...(z.capabilities ?? {}) };
}

export class TemporalDistressAnalyzer {
  version = RULE_VERSION;
  levels = new Map<number, TrackLevel>();
  assessments = new Map<number, DistressAssessment>();
  private state = new Map<string, State>();
  private camera = "default";

  reset() {
    this.state.clear();
    this.levels.clear();
    this.assessments.clear();
  }

  setCamera(camera: string) {
    if (camera !== this.camera) {
      this.camera = camera;
      this.state.clear();
      this.levels.clear();
      this.assessments.clear();
    }
  }

  private key(id: number) {
    return `${this.camera}:${id}`;
  }

  evaluate({ tracks, zones, settings, now, wallClock, camera, frameQuality, acknowledgedTracks }: AssessInput): { assessments: DistressAssessment[]; observations: Observation[] } {
    this.setCamera(camera);
    const cfg = settings.distress;
    const out: DistressAssessment[] = [];
    const observations: Observation[] = [];
    if (!cfg.enabled) {
      this.levels.clear();
      this.assessments.clear();
      return { assessments: out, observations };
    }

    const waterZones = zones.filter((z) => z.enabled && (z.type === "SWIMMING" || z.type === "RESTRICTED") && z.points.length >= 3);
    const alive = new Set<number>();
    for (const tr of tracks) {
      if (tr.hits < settings.tracking.minHits) continue;
      alive.add(tr.id);
      const last = tr.history[tr.history.length - 1];
      if (!last) continue;
      const anchor = { x: last.cx, y: last.cy };
      const zi = zoneOfAnchor(anchor, zones);
      if (zi.ignored) {
        this.levels.set(tr.id, { level: 1, kind: null, until: now });
        const emptyQuality: EvidenceQuality = {
          level: "INSUFFICIENT",
          score: 0,
          reasons: ["track is inside an ignored zone"],
          frameLuma: frameQuality?.luma ?? null,
          frameContrast: frameQuality?.contrast ?? null,
          detectionConfidence: tr.lastDetScore || tr.score,
          boxHeight: tr.box.h,
          samples: 0,
          gapSeconds: 0,
        };
        const assessment = this.buildAssessment(tr, "NORMAL", 0, [], null, null, now, wallClock(), false, cfg.windowSeconds, 0, ["Track is inside an ignored zone."], emptyQuality, 0);
        this.assessments.set(tr.id, assessment);
        continue;
      }

      const caps = zi.zone ? mergeCaps(zi.zone) : DEFAULT_ZONE_CAPS;
      const f = computeTrackFeatures(tr, now, cfg.windowSeconds, cfg.contextSeconds, cfg, zi.zone?.points);
      const indicators: DistressIndicator[] = [];
      const add = (key: keyof typeof INDICATOR_WEIGHT, value: number, threshold: number, unit: string, strength: number, seconds: number, available = true, note?: string) => {
        if (strength <= 0) return;
        indicators.push({ key, label: INDICATOR_LABEL[key], value: r(value, 2), threshold, unit, strength: r(clamp01(strength), 2), seconds: r(seconds, 1), available, note });
      };

      // 1. Repeated submersion / re-acquisition inside the context window.
      if (caps.submersionObservable) {
        if (f.submersionEvents > 0) {
          const strength = clamp01(f.submersionEvents / Math.max(1, cfg.submersionCount * 2));
          add("submersion", f.submersionEvents, cfg.submersionCount, "re-acquisitions", strength, f.longestSubmersion, true, "A detector/tracker gap can also mean occlusion or an intentional dive.");
        }
        if (f.lossRecoveries > f.submersionEvents) {
          const spread = clamp01((f.lossRecoveries - f.submersionEvents) / 3);
          add("lossRecovery", f.lossRecoveries, 2, "loss/recovery cycles", spread * 0.55, cfg.lossRecoveryWindowSeconds, true, "Repeated loss/recovery is a weak, non-specific signal; occlusion can produce it.");
        }
      } else {
        indicators.push({ key: "submersion", label: INDICATOR_LABEL.submersion, value: 0, threshold: 0, unit: "not observable", strength: 0, seconds: 0, available: false, note: "This camera/zone is marked as unable to distinguish submersion from occlusion; no gap evidence is used." });
      }

      // 2. Struggling-like movement: repeated sharp reversals while still moving.
      if (f.reversals >= 1) {
        const reversalStrength = clamp01(f.reversals / Math.max(1, cfg.struggleReversals));
        const movementStrength = clamp01(f.meanSpeed / 0.06);
        add("struggle", f.reversals, cfg.struggleReversals, "direction reversals", reversalStrength * (0.5 + 0.5 * movementStrength), f.windowSeconds, true, "Splashing, playing and treading water can also produce reversals.");
      }

      // 3. Vertical posture (bounding-box proxy, not a pose model).
      if (caps.postureObservable && f.medianAspect >= cfg.postureAspect) {
        const strength = clamp01((f.medianAspect - cfg.postureAspect) / 1.1) * clamp01(f.windowSeconds / Math.max(1, cfg.postureSeconds));
        add("vertical", f.medianAspect, cfg.postureAspect, "height ÷ width", strength, f.windowSeconds, true, "Box aspect is a coarse proxy; a standing person in shallow water also looks vertical.");
      } else if (!caps.postureObservable) {
        indicators.push({ key: "vertical", label: INDICATOR_LABEL.vertical, value: 0, threshold: 0, unit: "not observable", strength: 0, seconds: 0, available: false, note: "The configured zone is too far/oblique to judge body posture." });
      }

      // 4. Prolonged immobility.
      if (f.lowSpeedSeconds >= cfg.immobilitySeconds * 0.5) {
        add("immobility", f.lowSpeedSeconds, cfg.immobilitySeconds, "seconds below speed threshold", clamp01(f.lowSpeedSeconds / cfg.immobilitySeconds), f.lowSpeedSeconds, true, "Floating and resting are normal and this indicator alone never creates a critical event.");
      }

      // 5. Movement without forward progress.
      if (f.windowSeconds >= cfg.noProgressSeconds && f.pathLength > 0.12 && f.netDisplacement <= cfg.noProgressMaxNet) {
        add("noProgress", f.netDisplacement, cfg.noProgressMaxNet, "net displacement", clamp01((cfg.noProgressMaxNet - f.netDisplacement) / cfg.noProgressMaxNet) * clamp01(f.pathLength / 0.25), f.windowSeconds);
      }

      // 6. Sudden change from prior movement to relative stillness.
      if (f.priorSpeed > 0.03 && f.speedRatio <= cfg.suddenChangeRatio) {
        add("suddenChange", f.speedRatio, cfg.suddenChangeRatio, "recent ÷ prior speed", clamp01((cfg.suddenChangeRatio - f.speedRatio) / cfg.suddenChangeRatio), f.windowSeconds);
      }

      if (zi.zoneType === "RESTRICTED") {
        add("restrictedZone", 1, 1, "zone", 1, f.windowSeconds, true, "Restricted-zone presence is a policy signal, not a drowning indicator.");
      }

      // Head/waterline relation requires a waterline/pose model. Even a "close"
      // zone cannot infer it from a detection box, so it stays unavailable.
      indicators.push({
        key: "headWaterline",
        label: "Head position relative to the water surface",
        value: 0,
        threshold: 0,
        unit: "not observable",
        strength: 0,
        seconds: 0,
        available: false,
        note: "Requires a waterline/pose model; not claimed by this camera-only baseline.",
      });

      const usable = indicators.filter((i) => i.available && i.strength >= 0.25 && i.key !== "headWaterline");
      const families = new Set(usable.filter((i) => i.key !== "restrictedZone").map((i) => INDICATOR_FAMILY[i.key] ?? i.key));
      const independentSignals = families.size;
      const strong = usable.filter((i) => i.strength >= cfg.strongIndicatorStrength);
      const score = clamp01(
        indicators.reduce((sum, i) => {
          if (!i.available) return sum;
          const weight = INDICATOR_WEIGHT[i.key as keyof typeof INDICATOR_WEIGHT] ?? 0;
          return sum + i.strength * weight;
        }, 0),
      );

      const quality = evidenceQuality(tr, f, frameQuality, cfg, caps);
      const waterZoneConfigured = waterZones.length > 0;
      const waterContext = zi.zoneType === "SWIMMING" || zi.zoneType === "RESTRICTED";
      let raw: RiskLevel = "NORMAL";
      const limitations: string[] = [];
      const ack = !!acknowledgedTracks?.has(tr.id);

      if (!waterZoneConfigured) {
        raw = "UNCERTAIN";
        limitations.push("No enabled water zone is configured; water-distress escalation is disabled until the operator calibrates the monitored water area.");
      } else if (!waterContext) {
        // Movement on land/background is not water-distress evidence.
        raw = zi.zoneType === "RESTRICTED" ? "WATCH" : "NORMAL";
        limitations.push("Track is outside the configured water zones; water-distress indicators do not apply.");
      } else if (f.ageSeconds < cfg.minTrackSeconds) {
        raw = "INSUFFICIENT_VISIBILITY";
        limitations.push("Track history is shorter than the minimum assessment window.");
      } else if (quality.level === "INSUFFICIENT") {
        raw = "INSUFFICIENT_VISIBILITY";
        limitations.push("Insufficient evidence quality: " + quality.reasons.join("; "));
      } else if (quality.level === "LIMITED") {
        raw = score >= cfg.watchScore ? "UNCERTAIN" : "INSUFFICIENT_VISIBILITY";
        limitations.push("Limited evidence quality prevents a confident water-distress classification.");
      } else {
        const postureOnly = usable.every((i) => i.key === "vertical");
        const core = usable.some((i) => ["submersion", "struggle", "immobility", "noProgress", "lossRecovery"].includes(i.key));
        if (score >= cfg.watchScore) raw = "WATCH";
        if (score >= cfg.suspectedScore && independentSignals >= cfg.minIndependentSignals && strong.length >= 1 && !postureOnly) raw = "SUSPECTED";
        // Critical is deliberately conservative: multiple independent families,
        // at least two strong signals, and a core behavioural indicator. A
        // single vertical posture or a single still period can never qualify.
        if (
          score >= cfg.criticalScore &&
          independentSignals >= cfg.criticalMinIndependentSignals &&
          strong.length >= 2 &&
          core &&
          usable.some((i) => i.key === "submersion" || i.key === "struggle" || i.key === "lossRecovery")
        ) {
          raw = "CRITICAL";
        }
      }
      if (zi.zoneType === "RESTRICTED" && raw === "NORMAL") raw = "WATCH";
      if (ack && LEVEL_RANK[raw] >= LEVEL_RANK.WATCH) raw = "OPERATOR_ACKNOWLEDGED";
      if (f.edgeDistance > 0 && f.edgeDistance < cfg.zoneEdgeMargin) {
        limitations.push("Track is near the calibrated water-zone edge; boundary ambiguity is treated as limited evidence and cannot be critical.");
        if (raw === "CRITICAL") raw = "SUSPECTED";
      }

      const k = this.key(tr.id);
      const st: State = this.state.get(k) ?? {
        candidate: "NORMAL" as RiskLevel,
        candidateSince: now,
        level: "NORMAL" as RiskLevel,
        levelSince: now,
        lastEmit: {},
        lastEmittedLevel: null,
        lastSeen: now,
        zone: null,
        lastAssessment: null,
        lastIndicators: [],
        incidentCount: 0,
      };
      st.lastSeen = now;
      st.zone = zi.zone?.name ?? null;
      const lost = tr.state === "lost" && now - tr.lastT > 0.5;
      if (lost) {
        // A disappearance is not an emergency by itself. Keep the last visible
        // assessment for the operator, but do not escalate or emit new alerts.
        const prior = this.assessments.get(tr.id);
        if (prior) {
          const visible = { ...prior, visible: false, at: wallClock(), evidenceQuality: quality };
          this.assessments.set(tr.id, visible);
          out.push(visible);
        }
        this.levels.set(tr.id, { level: riskToLevel(prior?.level ?? "NORMAL") as 1 | 2 | 3 | 4, kind: RISK_LABEL[prior?.level ?? "NORMAL"], until: now });
        this.state.set(k, st);
        continue;
      }

      if (raw !== st.candidate) {
        st.candidate = raw;
        st.candidateSince = now;
      }
      const persistFor: Record<RiskLevel, number> = {
        NORMAL: 0,
        INSUFFICIENT_VISIBILITY: 1.5,
        UNCERTAIN: 2,
        OPERATOR_ACKNOWLEDGED: 0,
        WATCH: cfg.watchPersistSeconds,
        SUSPECTED: cfg.suspectedPersistSeconds,
        CRITICAL: cfg.criticalPersistSeconds,
      };
      if (raw !== st.level) {
        const rawRank = LEVEL_RANK[raw];
        const levelRank = LEVEL_RANK[st.level];
        const held = now - st.candidateSince;
        if (held >= (persistFor[raw] ?? 0)) {
          if (rawRank > levelRank) {
            // Escalation is immediate once its persistence window is satisfied.
            st.level = raw;
            st.levelSince = now;
          } else if (held >= cfg.deescalateSeconds) {
            // De-escalate one step at a time, never straight from critical to normal.
            if (st.level === "CRITICAL") st.level = "SUSPECTED";
            else if (st.level === "SUSPECTED" || st.level === "OPERATOR_ACKNOWLEDGED") st.level = "WATCH";
            else st.level = raw;
            st.levelSince = now;
          }
        }
      }
      const level = st.level;
      st.lastIndicators = indicators;
      const decisionState: DecisionState =
        level === "OPERATOR_ACKNOWLEDGED"
          ? "OPERATOR_ACKNOWLEDGED"
          : level === "CRITICAL"
            ? "CRITICAL"
            : level === "SUSPECTED"
              ? "SUSPECTED"
              : level === "WATCH" || level === "UNCERTAIN"
                ? "WATCH"
                : level === "INSUFFICIENT_VISIBILITY"
                  ? "INSUFFICIENT_VISIBILITY"
                  : "NORMAL";

      const concerningSince = ["SUSPECTED", "CRITICAL", "WATCH", "UNCERTAIN", "OPERATOR_ACKNOWLEDGED"].includes(st.candidate) ? st.candidateSince : level !== "NORMAL" ? st.levelSince : null;
      const persistentSeconds = concerningSince === null ? 0 : now - concerningSince;
      const assessment = this.buildAssessment(tr, level, score, indicators, zi.zone?.name ?? null, zi.zoneType, now, wallClock(), tr.state === "tracked", f.windowSeconds, persistentSeconds, limitations, quality, independentSignals);
      assessment.decisionState = decisionState;
      assessment.samples = f.samples;
      assessment.trackAgeSeconds = r(f.ageSeconds, 1);
      assessment.anchor = { x: r(anchor.x, 4), y: r(anchor.y, 4) };
      assessment.detectionConfidence = r(tr.lastDetScore || tr.score, 3);
      assessment.capabilities = caps;
      if (!zi.zone) assessment.limitations.push("No enabled zone contains this track; zone name unavailable.");
      if (f.samples < 8) assessment.limitations.push("Fewer than 8 tracked samples in the analysis window.");
      if (quality.level === "LIMITED") assessment.limitations.push("Evidence quality is LIMITED; the system reports UNCERTAIN/INSUFFICIENT_VISIBILITY rather than NORMAL.");
      if (ack) assessment.limitations.push("Incident acknowledged by an operator; alerts are silenced but the incident remains open until resolved.");
      this.state.set(k, st);
      this.assessments.set(tr.id, assessment);
      this.levels.set(tr.id, { level: riskToLevel(level) as 1 | 2 | 3 | 4, kind: level === "NORMAL" ? null : RISK_LABEL[level], until: now });
      out.push(assessment);

      if ((level === "WATCH" || level === "SUSPECTED" || level === "CRITICAL") && quality.level !== "INSUFFICIENT") {
        const levelNum = riskToLevel(level) as 2 | 3 | 4;
        const lastEmit = st.lastEmit[level] ?? -Infinity;
        const cooldown = level === "CRITICAL" ? cfg.cooldownSeconds : level === "SUSPECTED" ? cfg.cooldownSeconds : cfg.cooldownSeconds * 2;
        const changedLevel = st.lastEmittedLevel !== level;
        if (changedLevel || now - lastEmit >= cooldown) {
          st.lastEmit[level] = now;
          st.lastEmittedLevel = level;
          st.incidentCount++;
          const reached = usable.map((i) => `${i.label}: ${i.value} ${i.unit} (threshold ${i.threshold}) for ${i.seconds}s`);
          const summary = this.summary(tr, level, indicators, zi.zone?.name ?? null, persistentSeconds);
          observations.push({
            at: wallClock(),
            level: levelNum,
            riskLevel: level,
            decisionState,
            kind: level === "CRITICAL" ? "Critical suspected swimmer distress" : level === "SUSPECTED" ? "Suspected swimmer distress" : "Unusual behavior — watch",
            trackId: tr.id,
            zone: zi.zone?.name ?? null,
            durationSeconds: r(persistentSeconds, 1),
            summary,
            features: {
              pathLength: r(f.pathLength),
              netDisplacement: r(f.netDisplacement),
              tortuosity: r(f.tortuosity, 2),
              directionReversals: f.reversals,
              stalledSeconds: r(f.stalledSeconds, 1),
              lowSpeedSeconds: r(f.lowSpeedSeconds, 1),
              meanSpeed: r(f.meanSpeed, 4),
              recentSpeed: r(f.recentSpeed, 4),
              priorSpeed: r(f.priorSpeed, 4),
              speedRatio: r(f.speedRatio, 2),
              medianBoxAspect: r(f.medianAspect, 2),
              boxAspectVariation: r(f.aspectStd, 2),
              submersionEvents: f.submersionEvents,
              longestSubmersionSeconds: r(f.longestSubmersion, 1),
              lossRecoveries: f.lossRecoveries,
              trackAgeSeconds: r(f.ageSeconds, 1),
              samples: f.samples,
              independentSignals,
              zoneEdgeDistance: Number.isFinite(f.edgeDistance) ? r(f.edgeDistance, 4) : "not in zone",
              heuristicScore: r(score, 3),
              scoreKind: "unvalidated-heuristic",
              postureObservable: caps.postureObservable ? "yes" : "no",
              waterlineObservable: caps.waterlineObservable ? "yes" : "no",
            },
            thresholds: {
              windowSeconds: cfg.windowSeconds,
              contextSeconds: cfg.contextSeconds,
              minTrackSeconds: cfg.minTrackSeconds,
              postureAspect: cfg.postureAspect,
              struggleReversals: cfg.struggleReversals,
              submersionGapSeconds: cfg.submersionGapSeconds,
              submersionCount: cfg.submersionCount,
              immobilitySeconds: cfg.immobilitySeconds,
              noProgressMaxNet: cfg.noProgressMaxNet,
              watchScore: cfg.watchScore,
              suspectedScore: cfg.suspectedScore,
              criticalScore: cfg.criticalScore,
              deescalateSeconds: cfg.deescalateSeconds,
              visibilityMinScore: cfg.visibilityMinScore,
              visibilityMinBoxHeight: cfg.visibilityMinBoxHeight,
              minIndependentSignals: cfg.minIndependentSignals,
              criticalMinIndependentSignals: cfg.criticalMinIndependentSignals,
              strongIndicatorStrength: cfg.strongIndicatorStrength,
              persistenceSeconds: level === "CRITICAL" ? cfg.criticalPersistSeconds : level === "SUSPECTED" ? cfg.suspectedPersistSeconds : cfg.watchPersistSeconds,
            },
            reached,
            ruleVersion: RULE_VERSION,
            assessment,
            cameraId: camera,
            detectionConfidence: r(tr.lastDetScore || tr.score, 3),
            evidenceQuality: quality,
          });
        }
      }
    }

    // Remove states that have not been seen for a long time.
    for (const [k, st] of this.state) {
      if (now - st.lastSeen > 120) this.state.delete(k);
    }
    for (const id of [...this.levels.keys()]) {
      if (!alive.has(id)) {
        // Keep a lost assessment briefly so the operator sees it, but do not
        // classify a disappearance as an emergency by itself.
        const a = this.assessments.get(id);
        if (a) this.assessments.set(id, { ...a, visible: false, at: new Date().toISOString() });
      }
    }
    return { assessments: out, observations };
  }

  private buildAssessment(
    tr: Track,
    level: RiskLevel,
    score: number,
    indicators: DistressIndicator[],
    zone: string | null,
    zoneType: ZoneType | null,
    now: number,
    at: string,
    visible: boolean,
    windowSeconds: number,
    persistentSeconds: number,
    limitations: string[],
    quality: EvidenceQuality,
    independentSignals: number,
  ): DistressAssessment {
    return {
      trackId: tr.id,
      level,
      decisionState: level === "CRITICAL" ? "CRITICAL" : level === "SUSPECTED" ? "SUSPECTED" : level === "WATCH" || level === "UNCERTAIN" ? "WATCH" : level === "INSUFFICIENT_VISIBILITY" ? "INSUFFICIENT_VISIBILITY" : level === "OPERATOR_ACKNOWLEDGED" ? "OPERATOR_ACKNOWLEDGED" : "NORMAL",
      score: r(score, 3),
      independentSignals,
      scoreKind: "unvalidated-heuristic",
      modelConfidence: null,
      evidenceQuality: quality,
      indicators,
      concerningSince: persistentSeconds > 0 ? r(now - persistentSeconds, 1) : null,
      persistentSeconds: r(persistentSeconds, 1),
      zone,
      zoneType,
      at,
      visible,
      requiresReview: level === "SUSPECTED" || level === "CRITICAL",
      detectionConfidence: r(tr.lastDetScore || tr.score, 3),
      windowSeconds,
      samples: 0,
      trackAgeSeconds: 0,
      anchor: { x: tr.box.x + tr.box.w / 2, y: tr.box.y + tr.box.h / 2 },
      box: { ...tr.box },
      camera: this.camera,
      capabilities: DEFAULT_ZONE_CAPS,
      limitations: [
        "Experimental temporal baseline — thresholds are not validated on representative water footage.",
        "Detector/tracker gaps may be occlusion, intentional diving, or a missed detection.",
        "No head/waterline pose or face recognition is used.",
        ...limitations,
      ],
    };
  }

  private summary(tr: Track, level: RiskLevel, indicators: DistressIndicator[], zone: string | null, persistentSeconds: number) {
    const labels = indicators.filter((i) => i.available && i.strength >= 0.25).map((i) => i.label.toLowerCase());
    const where = zone ? `zone “${zone}”` : "the unzoned monitored area";
    const prefix = level === "CRITICAL" ? "Critical suspected distress" : level === "SUSPECTED" ? "Suspected distress" : level === "UNCERTAIN" ? "Uncertain screening result" : level === "INSUFFICIENT_VISIBILITY" ? "Insufficient visibility" : "Watch";
    return `${prefix} for anonymous track #${tr.id} in ${where}: ${labels.join("; ") || "no strong indicator"}. Pattern observed for ${r(persistentSeconds, 1)}s. This is a screening result, not a confirmed drowning; lifeguard review is required.`;
  }
}

const INDICATOR_LABEL: Record<keyof typeof INDICATOR_WEIGHT, string> = {
  submersion: "Repeated submersion / loss of the swimmer",
  struggle: "Struggling-like erratic movement",
  vertical: "Vertical body posture in the water",
  immobility: "Prolonged immobility",
  noProgress: "Movement without forward progress",
  suddenChange: "Sudden change in movement pattern",
  restrictedZone: "Presence in a restricted zone",
  lossRecovery: "Repeated track loss and recovery",
};



