export type Box = { x: number; y: number; w: number; h: number }; // normalized 0..1 image space

export type Detection = {
  box: Box;
  score: number;
  classId: number; // COCO class 1 = person
  label: string;
  frameId: number;
  t: number; // seconds (performance clock)
};

export type TrackPoint = { t: number; cx: number; cy: number; w: number; h: number; score: number };

export type Track = {
  id: number;
  box: Box;
  state: "tentative" | "tracked" | "lost";
  firstT: number;
  lastT: number; // last time a detection was associated
  lostSince: number | null;
  hits: number;
  misses: number;
  totalMisses: number;
  gaps: number[]; // durations of past missing intervals (s)
  gapEvents: { t: number; seconds: number }[]; // when the track became visible again
  vx: number; // apparent velocity, normalized image units / s
  vy: number;
  score: number;
  /** Raw score of the most recent associated detection. */
  lastDetScore: number;
  history: TrackPoint[];
  /** Consecutive seconds the anchor has stayed below the stillness threshold. */
  stationarySeconds: number;
  /** Last matched-sample speed, normalized units / s. */
  speed: number;
  /** Number of times a lost track was re-associated. */
  reacquisitions: number;
  /** Consecutive associated detections (reset on a miss). */
  consecutiveHits?: number;
  /** Consecutive missed updates; a single miss does not fragment a confirmed track. */
  consecutiveMisses?: number;
  /** Time at which the track reached confirmed status. */
  confirmedAt?: number;
};

export type FrameStats = {
  frameId: number;
  latencyMs: number;
  detections: number;
};
