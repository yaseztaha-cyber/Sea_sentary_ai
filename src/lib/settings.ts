// Shared settings model. Persisted in PostgreSQL via /api/settings and
// consumed by the in-browser AI engine (inference frequency, tracker, distress,
// heat map, critical-alert audio).

export type HeatmapMode = "occupancy" | "movement" | "dwell";
export type RiskLevel = "NORMAL" | "WATCH" | "SUSPECTED" | "CRITICAL" | "UNCERTAIN" | "INSUFFICIENT_VISIBILITY" | "OPERATOR_ACKNOWLEDGED";

export type Settings = {
  camera: { width: number; height: number; fps: number; deviceId: string | null; autoConnect: boolean };
  inference: {
    targetFps: number;
    minScore: number;
    maxDetections: number;
    inputSize: number;
    backend: "auto" | "webgl" | "cpu";
    adaptive: boolean;
    minTargetFps: number;
    maxFrameAgeMs: number;
  };
  tracking: {
    iouThreshold: number;
    maxLostSeconds: number;
    minHits: number;
    trailSeconds: number;
    trailMaxGapSeconds: number;
    highScore: number;
    lowScore: number;
    maxJumpPerSecond: number;
    sizeGateMin: number;
    sizeGateMax: number;
    smoothingTau: number;
    duplicateIou: number;
    positionSmoothing: number;
    confirmationHits: number;
    lostAfterMisses: number;
    maxPredictSeconds: number;
    lostRecoveryGrowth: number;
  };
  distress: {
    enabled: boolean;
    windowSeconds: number;
    contextSeconds: number;
    minTrackSeconds: number;
    postureAspect: number;
    postureSeconds: number;
    struggleReversals: number;
    struggleSeconds: number;
    submersionGapSeconds: number;
    submersionCount: number;
    immobilitySeconds: number;
    immobilitySpeed: number;
    noProgressSeconds: number;
    noProgressMaxNet: number;
    suddenChangeRatio: number;
    watchScore: number;
    suspectedScore: number;
    criticalScore: number;
    watchPersistSeconds: number;
    suspectedPersistSeconds: number;
    criticalPersistSeconds: number;
    cooldownSeconds: number;
    repeatAlertSeconds: number;
    maxRepeatAlerts: number;
    createIncidentLevel: 3 | 4;
    deescalateSeconds: number;
    visibilityMinScore: number;
    visibilityMinBoxHeight: number;
    visibilityMinSamples: number;
    visibilityMinLuma: number;
    visibilityMinContrast: number;
    requireWaterZone: boolean;
    minIndependentSignals: number;
    criticalMinIndependentSignals: number;
    strongIndicatorStrength: number;
    lossRecoveryWindowSeconds: number;
    maxSubmersionSeconds: number;
    zoneEdgeMargin: number;
    deescalateStepSeconds: number;
  };
  // Legacy rule thresholds are retained so existing saved settings and the
  // zone-presence rules keep working; distress assessment is configured above.
  behavior: {
    enabled: boolean;
    windowSeconds: number;
    reversalCount: number;
    tortuosity: number;
    stallSeconds: number;
    disappearanceSeconds: number;
    minTrackSeconds: number;
    createIncidentLevel: 2 | 3;
  };
  heatmap: {
    windowSeconds: 60 | 300 | 900 | 1800;
    intensity: number;
    opacity: number;
    mode: HeatmapMode;
    decayHalfLifeSeconds: number;
    monitoredOnly: boolean;
  };
  alerts: {
    audioEnabled: boolean;
    sirenEnabled: boolean;
    voiceEnabled: boolean;
    volume: number;
    repeatSeconds: number;
    maxRepeats: number;
    requireRecordedVoice: boolean;
    allowSynthFallback: boolean;
  };
  notifications: {
    inApp: boolean;
    browser: boolean;
    audio: boolean;
    webPush: { enabled: boolean; includeEvidence: boolean };
    telegram: { enabled: boolean; chatId: string; sendEvidence: boolean; sendAudio: boolean };
    phone: { enabled: boolean; autoCall: boolean; escalationSeconds: number; retrySeconds: number; maxAttempts: number; responders: string[]; manualNumber: string };
  };
  evidence: {
    maxIncidentsWithEvidence: number;
    groupWindowSeconds: number;
    clipSeconds: number;
    maxClipBytes: number;
    retentionDays: number;
    preRollSeconds: number;
    maxPreBufferFrames: number;
  };
};

export const DEFAULT_SETTINGS: Settings = {
  camera: { width: 1920, height: 1080, fps: 30, deviceId: null, autoConnect: false },
  // 640 px selected by the interleaved on-machine benchmark (best p50 and highest
  // mean detection score in the clean 10-pass run). Quality floor matters more
  // than a higher frame count for swimmer safety.
  inference: { targetFps: 6, minScore: 0.5, maxDetections: 20, inputSize: 640, backend: "auto", adaptive: true, minTargetFps: 2, maxFrameAgeMs: 700 },
  tracking: {
    iouThreshold: 0.25,
    maxLostSeconds: 4,
    minHits: 3,
    trailSeconds: 8,
    trailMaxGapSeconds: 0.9,
    highScore: 0.5,
    lowScore: 0.18,
    maxJumpPerSecond: 1.8,
    sizeGateMin: 0.35,
    sizeGateMax: 2.8,
    smoothingTau: 0.25,
    duplicateIou: 0.55,
    positionSmoothing: 0.18,
    confirmationHits: 2,
    lostAfterMisses: 2,
    maxPredictSeconds: 2.5,
    lostRecoveryGrowth: 1,
  },
  distress: {
    enabled: true,
    windowSeconds: 20,
    contextSeconds: 60,
    minTrackSeconds: 6,
    postureAspect: 1.55,
    postureSeconds: 4,
    struggleReversals: 5,
    struggleSeconds: 3,
    submersionGapSeconds: 1.1,
    submersionCount: 2,
    immobilitySeconds: 8,
    immobilitySpeed: 0.012,
    noProgressSeconds: 10,
    noProgressMaxNet: 0.035,
    suddenChangeRatio: 0.65,
    watchScore: 0.24,
    suspectedScore: 0.5,
    criticalScore: 0.72,
    watchPersistSeconds: 3,
    suspectedPersistSeconds: 5,
    criticalPersistSeconds: 6,
    cooldownSeconds: 25,
    repeatAlertSeconds: 60,
    maxRepeatAlerts: 3,
    createIncidentLevel: 3,
    deescalateSeconds: 8,
    visibilityMinScore: 0.42,
    visibilityMinBoxHeight: 0.055,
    visibilityMinSamples: 5,
    visibilityMinLuma: 28,
    visibilityMinContrast: 10,
    requireWaterZone: true,
    minIndependentSignals: 2,
    criticalMinIndependentSignals: 3,
    strongIndicatorStrength: 0.5,
    lossRecoveryWindowSeconds: 30,
    maxSubmersionSeconds: 8,
    zoneEdgeMargin: 0.035,
    deescalateStepSeconds: 6,
  },
  behavior: {
    enabled: true,
    windowSeconds: 10,
    reversalCount: 4,
    tortuosity: 4,
    stallSeconds: 4,
    disappearanceSeconds: 4,
    minTrackSeconds: 5,
    createIncidentLevel: 3,
  },
  heatmap: { windowSeconds: 300, intensity: 1.2, opacity: 0.7, mode: "occupancy", decayHalfLifeSeconds: 120, monitoredOnly: true },
  alerts: { audioEnabled: false, sirenEnabled: true, voiceEnabled: true, volume: 0.8, repeatSeconds: 60, maxRepeats: 3, requireRecordedVoice: true, allowSynthFallback: false },
  notifications: {
    inApp: true,
    browser: false,
    audio: false,
    webPush: { enabled: false, includeEvidence: false },
    telegram: { enabled: false, chatId: "", sendEvidence: true, sendAudio: false },
    phone: { enabled: false, autoCall: false, escalationSeconds: 60, retrySeconds: 30, maxAttempts: 2, responders: [], manualNumber: "" },
  },
  evidence: { maxIncidentsWithEvidence: 40, groupWindowSeconds: 120, clipSeconds: 4, maxClipBytes: 2500000, retentionDays: 30, preRollSeconds: 8, maxPreBufferFrames: 8 },
};

export function mergeSettings(stored: unknown): Settings {
  const out: Record<string, unknown> = {};
  const src = (stored && typeof stored === "object" ? stored : {}) as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    out[k] = { ...DEFAULT_SETTINGS[k], ...(src[k] ?? {}) };
  }
  const s = out as Settings;
  // Nested notification groups may be absent in older saved settings.
  s.notifications = { ...DEFAULT_SETTINGS.notifications, ...(src.notifications ?? {}) } as Settings["notifications"];
  s.notifications.webPush = { ...DEFAULT_SETTINGS.notifications.webPush, ...((src.notifications as Settings["notifications"] | undefined)?.webPush ?? {}) };
  s.notifications.telegram = { ...DEFAULT_SETTINGS.notifications.telegram, ...((src.notifications as Settings["notifications"] | undefined)?.telegram ?? {}) };
  s.notifications.phone = { ...DEFAULT_SETTINGS.notifications.phone, ...((src.notifications as Settings["notifications"] | undefined)?.phone ?? {}) };
  // normalize values that used to live in a different shape
  if (!["occupancy", "movement", "dwell"].includes(s.heatmap.mode)) s.heatmap.mode = "occupancy";
  if (!["auto", "webgl", "cpu"].includes(s.inference.backend)) s.inference.backend = "auto";
  if (s.distress.createIncidentLevel !== 4) s.distress.createIncidentLevel = 3;
  if (s.behavior.createIncidentLevel !== 2) s.behavior.createIncidentLevel = 3;
  return s;
}

export type ZoneType = "OBSERVATION" | "SWIMMING" | "RESTRICTED" | "IGNORE";
export type Pt = { x: number; y: number };
export type ZoneCapabilities = {
  /** The camera view is close enough to judge body height/width (> ~55 px person box). */
  postureObservable: boolean;
  /** The water surface / waterline can be seen near the swimmer. */
  waterlineObservable: boolean;
  /** A track gap is likely to mean submersion in this view, not just occlusion. */
  submersionObservable: boolean;
};
export type Zone = { id: number; name: string; type: ZoneType; enabled: boolean; points: Pt[]; capabilities?: ZoneCapabilities };
export const DEFAULT_ZONE_CAPS: ZoneCapabilities = { postureObservable: true, waterlineObservable: false, submersionObservable: true };

export type IncidentStatus = "NEW" | "ACKNOWLEDGED" | "UNDER_REVIEW" | "RESOLVED" | "FALSE_ALARM";

export type DistressIndicator = {
  key: string;
  label: string;
  value: number;
  threshold: number;
  unit: string;
  strength: number; // 0..1, how strongly this indicator is present
  seconds: number; // how long it has persisted
  available: boolean; // false when the view cannot observe it
  note?: string;
};

export type EvidenceQuality = {
  level: "GOOD" | "LIMITED" | "INSUFFICIENT";
  score: number;
  reasons: string[];
  frameLuma: number | null;
  frameContrast: number | null;
  detectionConfidence: number;
  boxHeight: number;
  samples: number;
  gapSeconds: number;
};

export type DistressAssessment = {
  trackId: number;
  level: RiskLevel;
  /** Explicit temporal decision state, retained separately from the visual risk label. */
  decisionState: "NORMAL" | "WATCH" | "SUSPECTED" | "CRITICAL" | "INSUFFICIENT_VISIBILITY" | "OPERATOR_ACKNOWLEDGED";
  /** Heuristic baseline score. NEVER labelled as a model probability. */
  score: number;
  /** Number of independent indicator families currently active. */
  independentSignals: number;
  scoreKind: "unvalidated-heuristic";
  modelConfidence: number | null;
  evidenceQuality: EvidenceQuality;
  detectionConfidence: number;
  indicators: DistressIndicator[];
  concerningSince: number | null;
  persistentSeconds: number;
  zone: string | null;
  zoneType: ZoneType | null;
  at: string;
  visible: boolean;
  requiresReview: boolean;
  windowSeconds: number;
  samples: number;
  trackAgeSeconds: number;
  anchor: { x: number; y: number };
  box: { x: number; y: number; w: number; h: number };
  camera: string;
  capabilities?: ZoneCapabilities;
  limitations: string[];
};

export type Observation = {
  at: string; // ISO
  level: 2 | 3 | 4; // 2 WATCH · 3 SUSPECTED · 4 CRITICAL
  riskLevel?: RiskLevel;
  decisionState?: "NORMAL" | "WATCH" | "SUSPECTED" | "CRITICAL" | "INSUFFICIENT_VISIBILITY" | "OPERATOR_ACKNOWLEDGED";
  kind: string;
  trackId: number | null;
  zone: string | null;
  durationSeconds: number;
  summary: string;
  features: Record<string, number | string>;
  thresholds: Record<string, number | string>;
  reached: string[];
  ruleVersion: string;
  assessment?: DistressAssessment;
  alertLatencyMs?: number;
  cameraId?: string | null;
  detectionConfidence?: number;
  evidenceQuality?: EvidenceQuality;
  test?: boolean;
};

export type FrameQuality = { luma: number; contrast: number };

export const RULE_VERSION = "sentry-distress-0.2.0-experimental";
export const MODEL_VERSION = "coco-ssd/lite_mobilenet_v2 (TF.js, Apache-2.0) + temporal heuristic baseline (unvalidated)";

export const RISK_LABEL: Record<RiskLevel, string> = {
  NORMAL: "Normal",
  WATCH: "Watch",
  SUSPECTED: "Suspected distress",
  CRITICAL: "Critical suspected distress",
  UNCERTAIN: "Uncertain — limited view",
  INSUFFICIENT_VISIBILITY: "Insufficient visibility",
  OPERATOR_ACKNOWLEDGED: "Operator acknowledged",
};

export const riskToLevel = (r: RiskLevel): 1 | 2 | 3 | 4 =>
  r === "CRITICAL" ? 4 : r === "SUSPECTED" || r === "OPERATOR_ACKNOWLEDGED" ? 3 : r === "WATCH" || r === "UNCERTAIN" ? 2 : 1;
export const severityFromLevel = (level: 2 | 3 | 4): "WATCH" | "SUSPECTED" | "CRITICAL" => (level === 2 ? "WATCH" : level === 3 ? "SUSPECTED" : "CRITICAL");
