import { DEFAULT_SETTINGS, MODEL_VERSION, mergeSettings, type DistressAssessment, type FrameQuality, type HeatmapMode, type Observation, type RiskLevel, type Settings, type Zone } from "@/lib/settings";
import { CocoSsdDetector, type BackendSelection } from "./detector";
import { AnalysisPipeline } from "./pipeline";
import { drawTracks, drawZones } from "./draw";
import type { Detection } from "./types";
import { AlertAudioController, type AlertAudioStatus } from "@/lib/audio/alerts";

export type CameraState = "disconnected" | "connecting" | "connected" | "degraded" | "error";
export type ModelState = "idle" | "loading" | "ready" | "unavailable";
export type AiState = "off" | "no_source" | "loading" | "unavailable" | "processing" | "no_detections" | "tracking";

export type EngineEvent = { id: number; at: string; kind: "camera" | "ai" | "track" | "observation" | "incident" | "system" | "alert"; message: string; tone?: "warn" | "alert" | "ok" };
export type Notice = { id: number; at: string; title: string; body: string; tone: "alert" | "warn" | "error" | "info"; incidentId?: number };
export type TrackRow = {
  id: number;
  state: string;
  score: number;
  ageS: number;
  speed: number;
  level: 1 | 2 | 3 | 4;
  risk: RiskLevel;
  heuristicScore: number;
  persistentSeconds: number;
  zone: string | null;
  visible: boolean;
  gaps: number;
};

export type CriticalIncidentView = {
  id: number;
  ref: string;
  severity: string;
  status: string;
  title: string;
  trackId: number | null;
  zoneName: string | null;
  isTest: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
  lastObservationAt: string | null;
};

export type BenchmarkRow = {
  inputSize: number;
  runs: number;
  p50Ms: number;
  p95Ms: number;
  detections: number;
  avgScore: number;
  agreement: number | null;
};

export type BenchmarkResult = {
  at: string;
  source: string;
  provider: string;
  backend: string;
  selection: BackendSelection | null;
  referenceSize: number;
  rows: BenchmarkRow[];
  notes: string;
};

export type EngineSnapshot = {
  camera: {
    state: CameraState;
    error: string | null;
    label: string | null;
    width: number;
    height: number;
    actualFps: number | null;
    captureFps: number;
    live: boolean;
    frames: number;
    drops: number;
    deviceId: string | null;
  };
  devices: { deviceId: string; label: string }[];
  ai: {
    enabled: boolean;
    model: ModelState;
    modelError: string | null;
    backend: string;
    backendSelection: BackendSelection | null;
    backendReason: string;
    state: AiState;
    effectiveTargetFps: number;
    inferFps: number;
    detectorRate: number;
    trackingRate: number;
    latencyMs: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    preprocessMs: number;
    queueDelayMs: number;
    detections: number;
    inferenceFrames: number;
    tracked: number;
    lost: number;
    inputSize: number;
  };
  heatmap: {
    mode: HeatmapMode;
    windowSeconds: number;
    live: boolean;
    empty: boolean;
    samples: number;
    peakDwellSeconds: number;
    buckets: number;
    activeCells: number;
    masked: boolean;
    cameraKey: string;
    lastSampleAgeMs: number | null;
  };
  distress: {
    assessments: DistressAssessment[];
    counts: Record<RiskLevel, number>;
    modelStatus: string;
  };
  audio: AlertAudioStatus;
  critical: CriticalIncidentView[];
  perf: {
    captureFps: number;
    detectorRate: number;
    trackingRate: number;
    latencyMs: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    queueDelayMs: number;
    frames: number;
    drops: number;
    serverCpuPercent: number | null;
    serverRssMb: number | null;
    systemUsedMb: number | null;
    systemTotalMb: number | null;
    jsHeapMb: number | null;
    alertLatencyMs: number | null;
    provider: string;
    benchmark: BenchmarkResult | null;
    benchmarkRunning: boolean;
  };
  tracks: TrackRow[];
  events: EngineEvent[];
  observations: Observation[];
  notices: Notice[];
  zones: Zone[];
  settings: Settings;
  link: { sse: "connecting" | "open" | "error"; browserPermission: string; audio: "idle" | "ok" | "blocked" };
};

type SystemMetrics = { cpuPercent: number | null; rssMb: number | null; usedMb: number | null; totalMb: number | null };
type Listener = () => void;
const wall = () => new Date().toISOString();
const sec = () => performance.now() / 1000;

export class SentryEngine {
  video: HTMLVideoElement | null = null;
  stream: MediaStream | null = null;
  detector = new CocoSsdDetector();
  pipeline: AnalysisPipeline;
  settings: Settings = DEFAULT_SETTINGS;
  zones: Zone[] = [];
  lastDetections: Detection[] = [];
  alerts = new AlertAudioController();

  private cam = { state: "disconnected" as CameraState, error: null as string | null, label: null as string | null, width: 0, height: 0, actualFps: null as number | null, deviceId: null as string | null };
  private devices: { deviceId: string; label: string }[] = [];
  private frames = 0;
  private fpsFrames = 0;
  private fpsT = performance.now();
  private captureFps = 0;
  private lastFrameAt = 0;
  private processedFrame = -1;
  private drops = 0;
  private rvfc = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private preBuffer: { t: number; data: string }[] = [];
  private preTimer: ReturnType<typeof setInterval> | null = null;

  private aiOn = false;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private model: ModelState = "idle";
  private modelError: string | null = null;
  private aiState: AiState = "off";
  private inferTimes: number[] = [];
  private trackingTimes: number[] = [];
  private latencies: number[] = [];
  private lastLatency = 0;
  private lastPreprocess = 0;
  private queueDelay = 0;
  private inferFrames = 0;
  private lastDetCount = 0;
  private frameQuality: FrameQuality | undefined;
  private effectiveTargetFps = 6;
  private qualityCanvas: HTMLCanvasElement | null = null;
  private lastQualityAt = 0;

  private events: EngineEvent[] = [];
  private observations: Observation[] = [];
  private notices: Notice[] = [];
  private evId = 1;
  private link: EngineSnapshot["link"] = { sse: "connecting", browserPermission: "default", audio: "idle" };
  private listeners = new Set<Listener>();
  private snap: EngineSnapshot;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private es: EventSource | null = null;
  private started = false;
  private lastTelemetry = 0;
  private lastHeatTelemetry = 0;
  private heatCache = { at: 0, live: false, empty: true, samples: 0, peakDwellSeconds: 0, buckets: 0, activeCells: 0, masked: false, cameraKey: "default", lastSampleAgeMs: null as number | null };
  private system: SystemMetrics = { cpuPercent: null, rssMb: null, usedMb: null, totalMb: null };
  private systemTimer: ReturnType<typeof setInterval> | null = null;
  private critical: CriticalIncidentView[] = [];
  private criticalAttempts = new Map<number, { lastAt: number; count: number }>();
  private repeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastAlertLatency: number | null = null;
  private benchmark: BenchmarkResult | null = null;
  private benchmarkRunning = false;

  constructor() {
    this.pipeline = new AnalysisPipeline(this.settings);
    this.snap = this.build();
    this.alerts.subscribe(() => this.emit(true));
    this.alerts.onPlayback((rec) => this.recordLocalDelivery(rec));
  }

  /** Persists local siren/voice delivery records (best-effort, never blocks alerts). */
  private recordLocalDelivery(rec: import("@/lib/audio/alerts").AlertPlayback) {
    if (!Number.isFinite(rec.incidentId) || rec.incidentId <= 0) return;
    const sirenStatus = rec.sirenRequested ? (rec.sirenPlayed ? "SENT" : "FAILED") : "DISABLED";
    const voiceStatus = this.alerts.isAcknowledged(rec.incidentId)
      ? "ACKNOWLEDGED"
      : rec.voiceRequested
        ? rec.voicePlayed
          ? "SENT"
          : "FAILED"
        : "DISABLED";
    const base = {
      incidentId: rec.incidentId,
      phase: rec.repeat > 0 ? "REPEAT" : "CREATED",
    };
    void fetch(`/api/incidents/${rec.incidentId}/deliveries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...base,
        channel: "LOCAL_SIREN",
        status: sirenStatus,
        providerStatus: rec.sirenAssetUsed ? "LICENSED_RECORDING" : rec.sirenRequested ? "FALLBACK_TONE" : null,
        error: rec.sirenRequested && !rec.sirenPlayed ? rec.error ?? "no measurable signal" : null,
        payload: { peak: rec.signalPeak, zone: rec.zone, repeat: rec.repeat },
      }),
    }).catch(() => {});
    void fetch(`/api/incidents/${rec.incidentId}/deliveries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...base,
        channel: "LOCAL_VOICE",
        status: voiceStatus,
        providerStatus: rec.voiceAvailable ? "RECORDED_HUMAN_ASSET" : "NO_RECORDING",
        error: rec.voiceError,
        payload: { zone: rec.zone, spokenText: rec.spokenText, voiceError: rec.voiceError },
      }),
    }).catch(() => {});
  }

  /* ---------- subscription ---------- */
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  getServerSnapshot = () => this.snap;

  private emit(force = false) {
    const now = performance.now();
    // Keep React's external-store updates at 1 Hz while the AI is running.
    // Higher rates (4 Hz) starve Next.js route transitions under continuous
    // inference updates. Heat-map and video drawing run independently at
    // animation-frame rate.
    if (!force && now - this.lastEmit < 1000) {
      if (!this.emitTimer) this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit(true); }, 1020);
      return;
    }
    this.lastEmit = now;
    this.snap = this.build();
    this.listeners.forEach((l) => l());
  }

  isLive() {
    return this.cam.state === "connected" && performance.now() - this.lastFrameAt < 1500;
  }

  private currentRate(times: number[], windowMs = 4000) {
    const n = performance.now();
    for (let i = times.length - 1; i >= 0; i--) if (n - times[i] > windowMs) times.splice(0, i + 1);
    if (!times.length || times.length < 2) return times.length ? 0.25 : 0;
    return (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000);
  }

  private p95(arr: number[]) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  }

  private computeHeatStats(now: number) {
    if (now - this.heatCache.at < 0.4) return this.heatCache;
    const h = this.pipeline.heatmap;
    const s = this.settings.heatmap;
    const r = h.compute(s.windowSeconds, now, s.mode, s.decayHalfLifeSeconds);
    const trackedNow = this.pipeline.tracker.active().length > 0;
    this.heatCache = {
      at: now,
      live: trackedNow && this.isLive(),
      empty: r.buckets === 0 || r.peak <= 0,
      samples: h.samples,
      peakDwellSeconds: Math.round(r.peakDwellSeconds * 10) / 10,
      buckets: r.buckets,
      activeCells: r.activeCells,
      masked: h.masked,
      cameraKey: h.cameraKey,
      lastSampleAgeMs: h.lastSampleAt ? Math.max(0, (now - h.lastSampleAt) * 1000) : null,
    };
    return this.heatCache;
  }

  private jsHeapMb() {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
  }

  private build(): EngineSnapshot {
    const now = sec();
    const tr = this.pipeline.tracker.confirmed();
    const rows: TrackRow[] = tr.map((t) => {
      const a = this.pipeline.distress.assessments.get(t.id);
      return {
        id: t.id,
        state: t.state,
        score: t.score,
        ageS: now - t.firstT,
        speed: Math.hypot(t.vx, t.vy),
        level: a ? ((a.level === "NORMAL" ? 1 : a.level === "WATCH" ? 2 : a.level === "SUSPECTED" || a.level === "OPERATOR_ACKNOWLEDGED" ? 3 : 4) as 1 | 2 | 3 | 4) : 1,
        risk: a?.level ?? "NORMAL",
        heuristicScore: a?.score ?? 0,
        persistentSeconds: a?.persistentSeconds ?? 0,
        zone: a?.zone ?? null,
        visible: t.state === "tracked",
        gaps: t.gaps.length,
      };
    });
    const avg = this.latencies.length ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;
    const assessments = [...this.pipeline.distress.assessments.values()].sort((a, b) => {
      const rank: Record<RiskLevel, number> = { CRITICAL: 4, SUSPECTED: 3, OPERATOR_ACKNOWLEDGED: 2, WATCH: 2, UNCERTAIN: 1, NORMAL: 0, INSUFFICIENT_VISIBILITY: 0 };
      return rank[b.level] - rank[a.level] || b.score - a.score;
    });
    const counts: Record<RiskLevel, number> = { NORMAL: 0, WATCH: 0, SUSPECTED: 0, CRITICAL: 0, UNCERTAIN: 0, INSUFFICIENT_VISIBILITY: 0, OPERATOR_ACKNOWLEDGED: 0 };
    assessments.forEach((a) => counts[a.level]++);
    const heat = this.computeHeatStats(now);
    const detectorRate = this.currentRate(this.inferTimes);
    const trackingRate = this.currentRate(this.trackingTimes);
    return {
      camera: { ...this.cam, captureFps: this.captureFps, live: this.isLive(), frames: this.frames, drops: this.drops },
      devices: this.devices,
      ai: {
        enabled: this.aiOn,
        model: this.model,
        modelError: this.modelError,
        backend: this.detector.backend,
        backendSelection: this.detector.selection,
        backendReason: this.detector.selection?.reason ?? "not selected yet",
        state: this.aiState,
        effectiveTargetFps: this.effectiveTargetFps,
        inferFps: detectorRate,
        detectorRate,
        trackingRate,
        latencyMs: this.lastLatency,
        avgLatencyMs: avg,
        p95LatencyMs: this.p95(this.latencies),
        preprocessMs: this.lastPreprocess,
        detections: this.lastDetCount,
        queueDelayMs: this.queueDelay,
        inferenceFrames: this.inferFrames,
        tracked: tr.filter((t) => t.state === "tracked").length,
        lost: tr.filter((t) => t.state === "lost").length,
        inputSize: this.settings.inference.inputSize,
      },
      heatmap: {
        mode: this.settings.heatmap.mode,
        windowSeconds: this.settings.heatmap.windowSeconds,
        live: heat.live,
        empty: heat.empty,
        samples: heat.samples,
        peakDwellSeconds: heat.peakDwellSeconds,
        buckets: heat.buckets,
        activeCells: heat.activeCells,
        masked: heat.masked,
        cameraKey: heat.cameraKey,
        lastSampleAgeMs: heat.lastSampleAgeMs,
      },
      distress: { assessments, counts, modelStatus: "experimental temporal baseline · unvalidated thresholds" },
      audio: this.alerts.getStatus(),
      critical: this.critical.slice(0, 12),
      perf: {
        captureFps: this.captureFps,
        detectorRate,
        trackingRate,
        latencyMs: this.lastLatency,
        avgLatencyMs: avg,
        p95LatencyMs: this.p95(this.latencies),
        queueDelayMs: this.queueDelay,
        frames: this.frames,
        drops: this.drops,
        serverCpuPercent: this.system.cpuPercent,
        serverRssMb: this.system.rssMb,
        systemUsedMb: this.system.usedMb,
        systemTotalMb: this.system.totalMb,
        jsHeapMb: this.jsHeapMb(),
        alertLatencyMs: this.lastAlertLatency,
        provider: this.detector.selection ? `${this.detector.selection.backend} · ${this.detector.selection.reason}` : "not selected",
        benchmark: this.benchmark,
        benchmarkRunning: this.benchmarkRunning,
      },
      tracks: rows,
      events: this.events.slice(0, 100),
      observations: this.observations.slice(0, 60),
      notices: this.notices.slice(0, 20),
      zones: this.zones,
      settings: this.settings,
      link: { ...this.link },
    };
  }

  addEvent(kind: EngineEvent["kind"], message: string, tone?: EngineEvent["tone"]) {
    this.events.unshift({ id: this.evId++, at: wall(), kind, message, tone });
    if (this.events.length > 180) this.events.length = 180;
    this.emit();
  }

  /* ---------- bootstrap ---------- */
  async start() {
    if (this.started) return;
    this.started = true;
    if ("Notification" in window) this.link.browserPermission = Notification.permission;
    else this.link.browserPermission = "unsupported";
    await Promise.all([this.loadSettings(), this.loadZones()]);
    this.syncAlertConfig();
    this.openEvents();
    this.refreshDevices();
    if (this.settings.camera.autoConnect) this.connect();
    void this.refreshSystem();
    if (this.systemTimer) clearInterval(this.systemTimer);
    this.systemTimer = setInterval(() => void this.refreshSystem(), 3000);
    if (this.repeatTimer) clearInterval(this.repeatTimer);
    this.repeatTimer = setInterval(() => this.repeatTick(), 5000);
    void this.loadOpenCriticals();
    this.emit(true);
  }

  private syncAlertConfig() {
    this.alerts.configure({
      volume: this.settings.alerts.volume,
      sirenEnabled: this.settings.alerts.sirenEnabled,
      voiceEnabled: this.settings.alerts.voiceEnabled,
      audioEnabled: this.settings.alerts.audioEnabled,
      maxRepeats: this.settings.alerts.maxRepeats,
    });
  }

  async loadSettings() {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (r.ok) this.settings = mergeSettings(await r.json());
    } catch {
      this.addEvent("system", "Could not load settings from the server — using defaults", "warn");
    }
    this.effectiveTargetFps = this.settings.inference.targetFps;
    this.syncAlertConfig();
    this.emit(true);
  }

  async saveSettings(next: Settings) {
    this.settings = next;
    this.syncAlertConfig();
    this.emit(true);
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    if (!r.ok) {
      this.pushNotice({ title: "Settings not saved", body: "The server rejected the settings update.", tone: "error" });
      throw new Error("save failed");
    }
  }

  async saveSettingsLocal() {
    this.syncAlertConfig();
    this.emit(true);
  }

  /** Apply an immediate local settings change and return the new immutable snapshot. */
  applySettingsLocal(fn: (s: Settings) => void): Settings {
    const next = structuredClone(this.settings);
    fn(next);
    this.settings = next;
    this.syncAlertConfig();
    this.emit(true);
    return next;
  }

  async loadZones() {
    try {
      const r = await fetch("/api/zones", { cache: "no-store" });
      if (r.ok) this.zones = (await r.json()) as Zone[];
    } catch {
      /* keep previous zones */
    }
    this.emit(true);
  }

  private openEvents() {
    const es = new EventSource("/api/events");
    this.es = es;
    es.onopen = () => {
      this.link.sse = "open";
      this.emit(true);
    };
    es.onerror = () => {
      this.link.sse = es.readyState === EventSource.CLOSED ? "error" : "connecting";
      this.emit(true);
    };
    const on = (name: string, fn: (d: Record<string, unknown>) => void) =>
      es.addEventListener(name, (e) => {
        try {
          fn((JSON.parse((e as MessageEvent).data) as { data: Record<string, unknown> }).data);
        } catch {}
      });
    on("incident.created", (d) => this.onIncidentCreated(d));
    on("incident.escalated", (d) => this.onIncidentEscalated(d));
    on("incident.grouped", (d) => {
      this.addEvent("incident", `Observation grouped into ${d.ref} (${d.observationCount} observations)`, "warn");
      if (d.severity === "CRITICAL" && d.zoneName) {
        this.upsertCritical({ ...d, status: "NEW", severity: "CRITICAL" });
        this.announceIncidentFor(Number(d.id), String(d.ref), typeof d.zoneName === "string" ? d.zoneName : null, false, "grouped");
      }
    });
    on("incident.acknowledged", (d) => {
      this.addEvent("incident", `${d.ref} acknowledged — siren silenced, incident remains open`, "ok");
      this.alerts.acknowledge(Number(d.id));
      this.critical = this.critical.map((c) => (c.id === Number(d.id) ? { ...c, status: "ACKNOWLEDGED", acknowledgedAt: wall() } : c));
      this.emit(true);
    });
    on("incident.resolved", (d) => {
      this.addEvent("incident", `${d.ref} closed (${String(d.status).toLowerCase().replace("_", " ")})`, "ok");
      this.alerts.acknowledge(Number(d.id));
      this.critical = this.critical.filter((c) => c.id !== Number(d.id));
      this.emit(true);
    });
    on("incident.updated", (d) => this.addEvent("incident", `${d.ref} updated (${d.action})`));
    on("settings.updated", () => this.loadSettings());
    on("zones.updated", () => this.loadZones());
  }

  private onIncidentCreated(d: Record<string, unknown>) {
    const id = Number(d.id);
    const ref = String(d.ref);
    const sev = String(d.severity ?? "");
    const test = !!d.isTest;
    const zone = typeof d.zoneName === "string" ? d.zoneName : null;
    this.addEvent("incident", `${ref} created${test ? " (TEST)" : ""} — ${d.title}`, test ? "warn" : "alert");
    this.pushNotice({
      title: `${ref} — ${sev === "CRITICAL" ? "CRITICAL SUSPECTED DISTRESS" : sev === "SUSPECTED" ? "Suspected swimmer distress" : "Watch"}${test ? " · TEST" : ""}`,
      body: `${d.title}. Possible swimmer distress — verify and respond. In-app alert only; no external responder was contacted.`,
      tone: test ? "warn" : "alert",
      incidentId: id,
    });
    if (sev === "CRITICAL") {
      this.upsertCritical({ ...d, status: "NEW" });
      // A TEST incident only plays audio when the operator triggered the dedicated test path.
      if (!test) this.announceIncidentFor(id, ref, zone, false, "created");
    }
  }

  private onIncidentEscalated(d: Record<string, unknown>) {
    const id = Number(d.id);
    const ref = String(d.ref);
    const sev = String(d.severity ?? "");
    this.addEvent("incident", `${ref} escalated to ${sev}`, sev === "CRITICAL" ? "alert" : "warn");
    if (sev === "CRITICAL") {
      this.upsertCritical({ ...d, status: "NEW" });
      this.announceIncidentFor(id, ref, typeof d.zoneName === "string" ? d.zoneName : null, !!d.isTest, "escalated");
    }
  }

  private upsertCritical(d: Record<string, unknown>) {
    const id = Number(d.id);
    if (!Number.isFinite(id)) return;
    const row: CriticalIncidentView = {
      id,
      ref: String(d.ref ?? `INC-${id}`),
      severity: String(d.severity ?? "CRITICAL"),
      status: String(d.status ?? "NEW"),
      title: String(d.title ?? "Critical suspected swimmer distress"),
      trackId: typeof d.trackId === "number" ? d.trackId : null,
      zoneName: typeof d.zoneName === "string" ? d.zoneName : null,
      isTest: !!d.isTest,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : wall(),
      acknowledgedAt: typeof d.acknowledgedAt === "string" ? d.acknowledgedAt : null,
      lastObservationAt: typeof d.lastObservationAt === "string" ? d.lastObservationAt : null,
    };
    const i = this.critical.findIndex((c) => c.id === id);
    if (i >= 0) this.critical[i] = { ...this.critical[i], ...row };
    else this.critical.unshift(row);
    this.critical = this.critical.filter((c) => c.status !== "RESOLVED" && c.status !== "FALSE_ALARM").slice(0, 20);
    this.emit(true);
  }

  private async loadOpenCriticals() {
    try {
      const r = await fetch("/api/incidents?status=NEW,ACKNOWLEDGED,UNDER_REVIEW", { cache: "no-store" });
      if (!r.ok) return;
      const rows = (await r.json()) as CriticalIncidentView[];
      this.critical = rows.filter((x) => x.severity === "CRITICAL").slice(0, 20);
      this.emit(true);
    } catch {}
  }

  private async refreshSystem() {
    try {
      const r = await fetch("/api/system", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        this.system = {
          cpuPercent: typeof d.cpuPercent === "number" ? d.cpuPercent : null,
          rssMb: typeof d.rssMb === "number" ? d.rssMb : null,
          usedMb: typeof d.usedMb === "number" ? d.usedMb : null,
          totalMb: typeof d.totalMb === "number" ? d.totalMb : null,
        };
        this.emit();
      }
    } catch {}
  }

  private pushNotice(n: Omit<Notice, "id" | "at">) {
    if (!this.settings.notifications.inApp && n.tone !== "error") return;
    const id = this.evId++;
    this.notices.unshift({ ...n, id, at: wall() });
    this.emit(true);
    setTimeout(() => this.dismissNotice(id), n.tone === "alert" ? 30000 : 15000);
  }
  dismissNotice(id: number) {
    this.notices = this.notices.filter((n) => n.id !== id);
    this.emit(true);
  }

  async requestBrowserPermission() {
    if (!("Notification" in window)) {
      this.link.browserPermission = "unsupported";
    } else {
      this.link.browserPermission = await Notification.requestPermission();
    }
    this.emit(true);
  }

  /* ---------- critical audio ---------- */
  async enableAlertAudio(): Promise<boolean> {
    const ok = await this.alerts.unlock();
    if (ok) {
      if (!this.settings.alerts.audioEnabled) {
        this.settings = { ...this.settings, alerts: { ...this.settings.alerts, audioEnabled: true } };
        void this.saveSettings(this.settings).catch(() => {});
      }
      this.addEvent("alert", "Critical alert audio enabled by operator", "ok");
      // Re-announce any open, unacknowledged critical incident once audio is unlocked.
      this.criticalAttempts.clear();
      const open = this.critical.filter((c) => (c.status === "NEW" || c.status === "UNDER_REVIEW") && !c.isTest);
      if (open[0]) {
        this.announceIncidentFor(open[0].id, open[0].ref, open[0].zoneName, false, "unlock");
      }
    } else {
      this.addEvent("alert", `Alert audio could not be enabled: ${this.alerts.getStatus().message}`, "alert");
    }
    this.emit(true);
    return ok;
  }

  async testSiren() {
    const ok = await this.alerts.testSiren();
    this.addEvent("alert", ok ? "Siren test completed with measurable output" : `Siren test failed: ${this.alerts.getStatus().lastError ?? "no signal"}`, ok ? "ok" : "alert");
    this.emit(true);
    return ok;
  }

  async testVoice(zoneName?: string) {
    const zone = zoneName ?? this.zones.find((z) => z.enabled && z.type !== "IGNORE")?.name;
    const ok = await this.alerts.testVoice(zone);
    this.addEvent("alert", ok ? `Voice test completed${zone ? ` (${zone})` : ""}` : `Voice test failed: ${this.alerts.getStatus().lastError ?? "voice did not play"}`, ok ? "ok" : "alert");
    this.emit(true);
    return ok;
  }

  private announceIncidentFor(id: number, ref: string, zone: string | null, test: boolean, source: string) {
    const res = this.alerts.announce({ incidentId: id, ref, zone, at: wall() });
    if (res.queued) {
      const prev = this.criticalAttempts.get(id);
      this.criticalAttempts.set(id, { lastAt: Date.now(), count: (prev?.count ?? 0) + 1 });
      this.addEvent("alert", `${test ? "TEST · " : ""}siren + voice queued for ${ref}${zone ? ` · Zone ${zone}` : ""}`, "alert");
      // end-to-end latency is measured from incident creation/observation to the audio command
    } else if (res.reason) {
      const status = this.alerts.getStatus();
      this.pushNotice({
        title: `Audible alert not played — ${ref}`,
        body: `${res.reason}. Critical incident is still shown and requires operator review. Audio state: ${status.state}.`,
        tone: "error",
        incidentId: id,
      });
      this.addEvent("alert", `Audible alert NOT played for ${ref}: ${res.reason}`, "alert");
    }
    this.emit(true);
    void source;
  }

  private repeatTick() {
    if (!this.critical.length) return;
    const s = this.settings.alerts;
    const now = Date.now();
    for (const inc of this.critical) {
      if (inc.status === "ACKNOWLEDGED" || inc.status === "RESOLVED" || inc.status === "FALSE_ALARM") continue;
      if (inc.isTest) continue;
      const meta = this.criticalAttempts.get(inc.id);
      if (!meta) {
        // Audio locked: do not spam. The operator sees the locked state and the banner.
        const st = this.alerts.getStatus();
        if (st.state === "ready" && !this.alerts.isAcknowledged(inc.id)) {
          this.announceIncidentFor(inc.id, inc.ref, inc.zoneName, false, "repeat-initial");
        }
        continue;
      }
      if (meta.count > s.maxRepeats) continue;
      if (now - meta.lastAt < s.repeatSeconds * 1000) continue;
      if (this.alerts.getStatus().state !== "ready") continue;
      const res = this.alerts.announce({ incidentId: inc.id, ref: inc.ref, zone: inc.zoneName, at: wall() }, { force: true });
      if (res.queued) {
        this.criticalAttempts.set(inc.id, { lastAt: now, count: meta.count + 1 });
        this.addEvent("alert", `Repeat siren (${meta.count + 1}/${s.maxRepeats + 1}) for ${inc.ref}`, "alert");
      }
    }
  }

  async acknowledgeIncident(id: number): Promise<boolean> {
    this.alerts.acknowledge(id);
    this.critical = this.critical.map((c) => (c.id === id ? { ...c, status: "ACKNOWLEDGED", acknowledgedAt: wall() } : c));
    this.emit(true);
    try {
      const r = await fetch(`/api/incidents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acknowledge" }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.addEvent("incident", `Incident #${id} acknowledged — siren silenced, review still required`, "ok");
      return true;
    } catch (e) {
      this.pushNotice({ title: "Acknowledgment not saved", body: `${(e as Error).message}. The siren was silenced locally but the incident status may still be NEW.`, tone: "error", incidentId: id });
      return false;
    }
  }

  private telemetry(type: string, data: unknown) {
    void fetch("/api/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, data }) }).catch(() => {});
  }

  /* ---------- camera manager ---------- */
  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    this.devices = list.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1} (grant access to see its name)` }));
    this.emit(true);
  }

  private setCam(state: CameraState, error: string | null = null) {
    const changed = this.cam.state !== state;
    this.cam.state = state;
    this.cam.error = error;
    if (changed) {
      this.addEvent("camera", `Camera ${state}${error ? ` — ${error}` : ""}`, state === "error" ? "alert" : state === "degraded" ? "warn" : state === "connected" ? "ok" : undefined);
      this.telemetry("camera.state", { state, error, label: this.cam.label, width: this.cam.width, height: this.cam.height });
    }
    this.emit(true);
  }

  private async physicalCandidates(): Promise<{ id: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const read = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    let list = await read();
    if (list.length && !list.some((d) => d.label)) {
      // Labels are hidden until camera permission is granted. Prime permission
      // with a short-lived stream, then release it before the real connection.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
        list = await read();
      } catch {}
    }
    const virtual = /obs|virtual|snap|manycam|droidcam|iriun|epoccam|vmcap|camera\s*recorder/i;
    return list.filter((d) => d.deviceId && d.label && !virtual.test(d.label)).map((d) => ({ id: d.deviceId, label: d.label }));
  }

  async connect(deviceId?: string | null) {
    if (this.cam.state === "connecting") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setCam("error", "This browser does not expose camera access (requires https or localhost)");
      return;
    }
    this.releaseStream();
    this.setCam("connecting");
    const c = this.settings.camera;
    let explicitId = deviceId === undefined ? c.deviceId : deviceId;
    if (explicitId) {
      try {
        const current = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (!current.some((d) => d.deviceId === explicitId)) {
          this.addEvent("camera", "Saved camera is not present in this browser profile; selecting a physical camera automatically.", "warn");
          explicitId = null;
        }
      } catch {}
    }
    let id = explicitId;
    const candidates: { id: string | null; label: string }[] = explicitId
      ? [{ id: explicitId, label: "operator-selected camera" }]
      : (await this.physicalCandidates());
    if (!candidates.length) candidates.push({ id: null, label: "system default" });
    try {
      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          this.addEvent("camera", `Trying camera: ${candidate.label}`);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              ...(candidate.id ? { deviceId: { exact: candidate.id } } : {}),
              width: { ideal: c.width },
              height: { ideal: c.height },
              frameRate: { ideal: c.fps },
            },
          });
          id = candidate.id;
          break;
        } catch (e) {
          lastError = e;
          if (explicitId) break;
        }
      }
      if (!stream) throw lastError ?? new Error("No usable camera");
      this.addEvent("camera", `Camera opened: ${stream.getVideoTracks()[0]?.label ?? id ?? "default"}`, "ok");
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      const s = track.getSettings();
      const rawLabel = track.label || "Camera";
      // Chromium's fake camera exposes the capture-file path as its label.
      // Present it as a test source rather than leaking a local path into the UI.
      this.cam.label = /\.(y4m|mjpeg|mp4)$/i.test(rawLabel) || rawLabel.includes("test-artifacts") ? "Virtual test camera" : rawLabel;
      this.cam.deviceId = s.deviceId ?? id ?? null;
      this.cam.width = s.width ?? 0;
      this.cam.height = s.height ?? 0;
      this.cam.actualFps = s.frameRate ?? null;
      track.addEventListener("ended", () => {
        this.setCam("error", "Camera stream ended (device unplugged, in use elsewhere or permission revoked)");
        this.releaseStream(false);
      });
      this.video ??= document.createElement("video");
      const v = this.video;
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      this.frames = 0;
      this.lastFrameAt = performance.now();
      this.cam.width = v.videoWidth || this.cam.width;
      this.cam.height = v.videoHeight || this.cam.height;
      // Each physical camera gets its own heat-map and distress state.
      this.pipeline.setCamera(this.cam.deviceId ?? this.cam.label ?? "default");
      this.startFrameLoop();
      this.startWatchdog();
      this.startPreBuffer();
      await this.refreshDevices();
      this.setCam("connected");
      if (this.aiOn) this.scheduleAi(0);
    } catch (e) {
      const err = e as DOMException;
      const msg = err.name === "NotAllowedError" ? "Camera permission denied" : err.name === "NotFoundError" ? "No camera found" : err.name === "NotReadableError" ? "Camera is busy or cannot be opened (another application may be using it)" : err.name === "OverconstrainedError" ? "Selected camera not available" : err.message || "Unknown camera error";
      this.releaseStream(false);
      this.setCam("error", msg);
    }
  }

  private startFrameLoop() {
    const v = this.video!;
    const onFrame = () => {
      this.frames++;
      this.fpsFrames++;
      this.lastFrameAt = performance.now();
      const n = this.lastFrameAt;
      if (n - this.fpsT >= 1000) {
        this.captureFps = (this.fpsFrames * 1000) / (n - this.fpsT);
        this.fpsFrames = 0;
        this.fpsT = n;
        this.emit();
      }
      if (v.videoWidth && (v.videoWidth !== this.cam.width || v.videoHeight !== this.cam.height)) {
        this.cam.width = v.videoWidth;
        this.cam.height = v.videoHeight;
      }
      if (this.stream) this.rvfc = (v as HTMLVideoElement).requestVideoFrameCallback(onFrame);
    };
    if ("requestVideoFrameCallback" in v) {
      this.rvfc = v.requestVideoFrameCallback(onFrame);
    } else {
      let last = -1;
      const vv = v as HTMLVideoElement;
      const poll = () => {
        if (!this.stream) return;
        if (vv.currentTime !== last) {
          last = vv.currentTime;
          onFrame();
        }
        setTimeout(poll, 16);
      };
      poll();
    }
  }

  private startWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.stream) return;
      const gap = performance.now() - this.lastFrameAt;
      if (this.cam.state === "connected" && gap > 2000) this.setCam("degraded", "No new frames for more than 2 s — image is frozen");
      else if (this.cam.state === "degraded" && gap < 1000) this.setCam("connected");
      if (this.cam.state === "degraded" && gap > 10000) this.setCam("error", "Camera stopped delivering frames");
      this.emit();
    }, 1000);
  }

  private startPreBuffer() {
    if (this.preTimer) clearInterval(this.preTimer);
    this.preTimer = setInterval(() => {
      if (!this.isLive() || !this.video) return;
      const c = document.createElement("canvas");
      const w = 480;
      c.width = w;
      c.height = Math.round((w * this.video.videoHeight) / Math.max(1, this.video.videoWidth));
      c.getContext("2d")!.drawImage(this.video, 0, 0, c.width, c.height);
      this.preBuffer.push({ t: performance.now(), data: c.toDataURL("image/jpeg", 0.6) });
      if (this.preBuffer.length > 10) this.preBuffer.shift();
    }, 1000);
  }

  private releaseStream(clearLabel = true) {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.preTimer) clearInterval(this.preTimer);
    this.watchdog = null;
    this.preTimer = null;
    if (this.video && this.rvfc && "cancelVideoFrameCallback" in this.video) this.video.cancelVideoFrameCallback(this.rvfc);
    this.rvfc = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.preBuffer = [];
    this.captureFps = 0;
    if (clearLabel) {
      this.cam.label = null;
      this.cam.width = 0;
      this.cam.height = 0;
      this.cam.actualFps = null;
    }
  }

  disconnect() {
    this.releaseStream();
    this.setCam("disconnected");
    if (this.aiOn) this.aiState = "no_source";
    this.emit(true);
  }

  async reconnect() {
    const id = this.cam.deviceId;
    this.releaseStream(false);
    await this.connect(id);
  }

  /** Persist the chosen video source and reconnect if a camera is active. */
  async selectCamera(deviceId: string | null) {
    this.settings = { ...this.settings, camera: { ...this.settings.camera, deviceId } };
    this.emit(true);
    await this.saveSettings(this.settings);
    await this.refreshDevices();
    await this.connect(deviceId);
  }

  /* ---------- AI loop ---------- */
  async setAi(on: boolean) {
    this.aiOn = on;
    if (!on) {
      if (this.aiTimer) clearTimeout(this.aiTimer);
      this.aiState = "off";
      this.emit(true);
      return;
    }
    if (this.model !== "ready") {
      this.model = "loading";
      this.aiState = "loading";
      this.addEvent("ai", "Loading person detector (COCO-SSD lite_mobilenet_v2) and benchmarking installed TF.js backends…");
      this.emit(true);
      try {
        await this.detector.load(this.settings.inference.backend);
        this.model = "ready";
        this.modelError = null;
        this.addEvent("ai", `Model ready — executing on ${this.detector.backend} (${this.detector.selection?.reason ?? "no probe data"})`, "ok");
        if (this.settings.alerts.audioEnabled && this.alerts.getStatus().state === "locked") {
          this.addEvent("alert", "Critical alert audio is still locked — press “Enable alert audio” to unlock the siren and voice.", "warn");
        }
      } catch (e) {
        this.model = "unavailable";
        this.modelError = (e as Error).message || "Model failed to load";
        this.aiState = "unavailable";
        this.aiOn = false;
        this.addEvent("ai", `AI unavailable — ${this.modelError}`, "alert");
        this.emit(true);
        return;
      }
    }
    this.scheduleAi(0);
  }

  private scheduleAi(delay: number) {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (!this.aiOn) return;
    this.aiTimer = setTimeout(() => void this.aiTick(), delay);
  }

  private async aiTick() {
    if (!this.aiOn) return;
    const t0 = performance.now();
    const v = this.video;
    try {
      if (!v || !this.isLive() || v.readyState < 2) {
        this.aiState = "no_source";
        this.emit();
      } else if (this.frames === this.processedFrame) {
        // latest-frame policy: no new camera frame → no redundant inference
      } else {
        const frameId = this.frames;
        if (this.processedFrame >= 0) this.drops += Math.max(0, frameId - this.processedFrame - 1);
        this.processedFrame = frameId;
        this.queueDelay = performance.now() - this.lastFrameAt;
        const t = this.lastFrameAt > 0 ? this.lastFrameAt / 1000 : sec();
        const s = this.settings;
        const { detections, latencyMs, preprocessMs } = await this.detector.detect(v, v.videoWidth, v.videoHeight, frameId, t, s.inference);
        this.lastDetections = detections;
        this.lastDetCount = detections.filter((d) => d.score >= s.inference.minScore).length;
        this.lastLatency = latencyMs;
        this.lastPreprocess = preprocessMs;
        this.latencies.push(latencyMs);
        if (this.latencies.length > 60) this.latencies.shift();
        this.inferTimes.push(performance.now());
        this.inferFrames++;
        this.sampleFrameQuality(performance.now());
        // Acknowledged incidents stay open but must not keep re-alerting the
        // same track. This set is derived from persisted incident state, not
        // from a transient UI flag.
        const acknowledgedTracks = new Set(
          this.critical.filter((c) => c.status === "ACKNOWLEDGED" && c.trackId !== null).map((c) => c.trackId as number),
        );
        const r = this.pipeline.process(detections, t, s, this.zones.filter((z) => z.enabled), wall, true, undefined, this.frameQuality, acknowledgedTracks);
        this.adaptScheduler(detections.length);
        this.trackingTimes.push(performance.now());
        r.confirmedNow.forEach((tr) => this.addEvent("track", `Track #${tr.id} confirmed`));
        r.expired.forEach((tr) => this.addEvent("track", `Track #${tr.id} expired after ${(tr.lastT - tr.firstT).toFixed(1)}s (${tr.gaps.length} gaps)`));
        for (const o of r.observations) void this.handleObservation(o);
        const act = this.pipeline.tracker.active().length;
        this.aiState = act > 0 ? "tracking" : this.lastDetCount > 0 ? "processing" : "no_detections";
        const n = performance.now();
        if (n - this.lastTelemetry > 2000) {
          this.lastTelemetry = n;
          this.telemetry("ai.update", {
            detections: this.lastDetCount,
            tracked: act,
            inferFps: this.currentRate(this.inferTimes),
            trackingRate: this.currentRate(this.trackingTimes),
            latencyMs,
            preprocessMs,
            provider: this.detector.backend,
            inputSize: s.inference.inputSize,
          });
        }
        if (n - this.lastHeatTelemetry > 5000) {
          this.lastHeatTelemetry = n;
          this.telemetry("heatmap.updated", { samples: this.pipeline.heatmap.samples, mode: s.heatmap.mode, camera: this.pipeline.cameraKey });
        }
        this.emit();
      }
    } catch (e) {
      this.addEvent("ai", `Inference error — ${(e as Error).message}`, "alert");
      this.aiState = "unavailable";
      this.emit(true);
    }
    const target = 1000 / Math.max(1, this.effectiveTargetFps);
    this.scheduleAi(Math.max(0, target - (performance.now() - t0)));
  }

  private sampleFrameQuality(nowMs: number) {
    if (!this.video || nowMs - this.lastQualityAt < 1000) return;
    this.lastQualityAt = nowMs;
    try {
      if (!this.qualityCanvas) this.qualityCanvas = document.createElement("canvas");
      const c = this.qualityCanvas;
      c.width = 32;
      c.height = 24;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(this.video, 0, 0, 32, 24);
      const d = ctx.getImageData(0, 0, 32, 24).data;
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        sum2 += l * l;
      }
      const n = d.length / 4;
      const mean = sum / n;
      this.frameQuality = { luma: mean, contrast: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
    } catch {
      this.frameQuality = undefined;
    }
  }

  private adaptScheduler(detections: number) {
    const cfg = this.settings.inference;
    if (!cfg.adaptive) {
      this.effectiveTargetFps = cfg.targetFps;
      return;
    }
    const base = cfg.targetFps;
    const interval = 1000 / Math.max(1, base);
    const slow = this.lastLatency > interval * 1.5 || this.queueDelay > cfg.maxFrameAgeMs;
    const fast = this.lastLatency < interval * 0.65 && this.queueDelay < 180;
    if (slow) this.effectiveTargetFps = Math.max(cfg.minTargetFps, this.effectiveTargetFps * 0.85);
    else if (fast) this.effectiveTargetFps = Math.min(base, this.effectiveTargetFps + 0.08);
    void detections;
  }

  /* ---------- observations & incidents ---------- */
  private async handleObservation(o: Observation) {
    const started = performance.now();
    this.observations.unshift(o);
    if (this.observations.length > 80) this.observations.length = 80;
    const label = o.riskLevel ?? (o.level === 4 ? "CRITICAL" : o.level === 3 ? "SUSPECTED" : "WATCH");
    this.addEvent("observation", `${label} · ${o.kind}${o.trackId ? ` · track #${o.trackId}` : ""}`, o.level >= 3 ? "alert" : "warn");
    if (o.level >= this.settings.distress.createIncidentLevel) {
      const res = await this.createIncident(o);
      if (res) {
        this.lastAlertLatency = Math.round(performance.now() - started);
        if (o.level === 4) {
          // Local fast path; SSE deduplicates by incident id.
          this.upsertCritical({ id: res.id, ref: res.ref, severity: "CRITICAL", status: "NEW", title: o.kind, trackId: o.trackId, zoneName: o.zone, isTest: !!o.test, createdAt: wall() });
          if (!o.test) this.announceIncidentFor(res.id, res.ref, o.zone, false, "local");
          else this.announceIncidentFor(res.id, res.ref, o.zone, true, "test");
        }
      }
    }
  }

  async createIncident(o: Observation) {
    const ev = this.captureEvidence();
    const track = o.trackId !== null ? this.pipeline.tracker.tracks.find((t) => t.id === o.trackId) : undefined;
    const body = {
      observation: o,
      source: this.cam.label ?? "No camera (controlled test)",
      modelVersion: MODEL_VERSION,
      trackHistory: track ? track.history.slice(-240).map((p) => ({ t: Math.round(p.t * 100) / 100, x: Math.round(p.cx * 1000) / 1000, y: Math.round(p.cy * 1000) / 1000 })) : [],
      preEventSnapshot: this.preBuffer.length ? this.preBuffer[0].data : null,
      originalSnapshot: ev?.original ?? null,
      annotatedSnapshot: ev?.annotated ?? null,
      preEventFrames: this.preBuffer.map((p) => p.data),
      cameraId: this.cam.deviceId,
    };
    try {
      const r = await fetch("/api/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`server responded ${r.status}`);
      const result = (await r.json()) as { id: number; ref: string; grouped: boolean; severity?: string };
      void this.capturePostEventClip(result.id);
      return result;
    } catch (e) {
      this.pushNotice({ title: "Incident could not be saved", body: `${(e as Error).message}. No siren was played for this observation.`, tone: "error" });
      return null;
    }
  }

  /** Controlled TEST observation — clearly labelled, never presented as a real detection. */
  async raiseTestObservation(level: 3 | 4 = 3, zoneName?: string) {
    const tracks = this.pipeline.tracker.confirmed();
    const tr = tracks[0];
    const zone = zoneName ?? this.zones.find((z) => z.enabled && z.type === "SWIMMING")?.name ?? this.zones.find((z) => z.enabled && z.type !== "IGNORE")?.name ?? null;
    const o: Observation = {
      at: wall(),
      level,
      riskLevel: level === 4 ? "CRITICAL" : "SUSPECTED",
      kind: level === 4 ? "TEST critical suspected distress (controlled)" : "TEST suspected distress (controlled)",
      trackId: tr ? tr.id : null,
      zone,
      durationSeconds: 0,
      summary: `Operator-triggered controlled test at level ${level}. No behavior was actually detected. Exercises incident persistence, SSE, siren, voice, acknowledgment and evidence.`,
      features: { source: "operator test button", liveFrame: this.isLive() ? "yes" : "no", trackedPeople: tracks.length, scoreKind: "test — not model output" },
      thresholds: {},
      reached: ["manual trigger — not a model result"],
      ruleVersion: this.pipeline.distress.version,
      test: true,
    };
    this.observations.unshift(o);
    this.addEvent("observation", `TEST observation raised by operator (level ${level})`, "warn");
    const res = await this.createIncident(o);
    if (!res) return null;
    if (level === 4) {
      this.upsertCritical({ id: res.id, ref: res.ref, severity: "CRITICAL", status: "NEW", title: o.kind, trackId: o.trackId, zoneName: zone, isTest: true, createdAt: wall() });
      this.announceIncidentFor(res.id, res.ref, zone, true, "test");
    }
    return res;
  }

  private postClipBusy = false;

  private async capturePostEventClip(incidentId: number) {
    if (this.postClipBusy || !this.stream || typeof MediaRecorder === "undefined") return;
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
    if (!mime) return;
    this.postClipBusy = true;
    try {
      const rec = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 450_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.start(500);
      await new Promise((r) => setTimeout(r, Math.max(1, this.settings.evidence.clipSeconds) * 1000));
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime });
      if (blob.size === 0 || blob.size > this.settings.evidence.maxClipBytes) return;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      await fetch(`/api/incidents/${incidentId}/evidence`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postEventClip: dataUrl, mime }),
      });
    } catch {
      /* evidence clip is best-effort; the incident remains valid without it */
    } finally {
      this.postClipBusy = false;
    }
  }

  /* ---------- benchmarking ---------- */
  async benchmarkDetector(sizes: number[] = [320, 416, 512, 640], iterations = 8) {
    if (this.benchmarkRunning) return null;
    const v = this.video;
    if (!v || !v.videoWidth || !this.isLive()) {
      this.pushNotice({ title: "Benchmark not run", body: "A live camera frame is required; no synthetic frame is substituted.", tone: "error" });
      return null;
    }
    this.benchmarkRunning = true;
    this.emit(true);
    try {
      // Freeze one real camera frame so every resolution sees identical pixels.
      const frozen = document.createElement("canvas");
      frozen.width = v.videoWidth;
      frozen.height = v.videoHeight;
      frozen.getContext("2d", { alpha: false })!.drawImage(v, 0, 0);
      const source: CanvasImageSource = frozen;
      const opts = (size: number) => ({ minScore: this.settings.inference.minScore, maxDetections: this.settings.inference.maxDetections, inputSize: size });

      // Warm every resolution once, then interleave measured passes so later
      // resolutions cannot benefit from a warmed GPU/cache.
      for (const size of sizes) await this.detector.detect(source, v.videoWidth, v.videoHeight, -1, sec(), opts(size));
      const runs = new Map<number, number[]>(sizes.map((s) => [s, []]));
      let lastDets = new Map<number, Detection[]>();
      for (let i = 0; i < iterations; i++) {
        for (const size of sizes) {
          const r = await this.detector.detect(source, v.videoWidth, v.videoHeight, -2, sec(), opts(size));
          runs.get(size)!.push(r.latencyMs);
          lastDets.set(size, r.detections);
        }
      }
      let reference: Detection[] = [];
      let referenceSize = 640;
      for (const size of sizes) if (size === 640) reference = lastDets.get(size) ?? [];
      const results: BenchmarkRow[] = [];
      for (const size of sizes) {
        const arr = (runs.get(size) ?? []).slice().sort((a, b) => a - b);
        const dets = lastDets.get(size) ?? [];
        results.push({
          inputSize: size,
          runs: arr.length,
          p50Ms: Math.round(arr[Math.floor(arr.length / 2)] * 10) / 10,
          p95Ms: Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] * 10) / 10,
          detections: dets.length,
          avgScore: dets.length ? Math.round((dets.reduce((s, d) => s + d.score, 0) / dets.length) * 100) / 100 : 0,
          agreement: size === referenceSize ? 1 : reference.length ? Math.round((matchedDetections(reference, dets) / reference.length) * 100) / 100 : null,
        });
      }
      if (!sizes.includes(640)) {
        referenceSize = sizes[0];
        for (const row of results) row.agreement = row.inputSize === referenceSize ? 1 : null;
      }
      this.benchmark = {
        at: wall(),
        source: `${v.videoWidth}×${v.videoHeight} frozen live camera frame`,
        provider: this.detector.backend,
        backend: this.detector.backend,
        selection: this.detector.selection,
        referenceSize,
        rows: results,
        notes: "Interleaved measured passes. Agreement = fraction of 640 px reference detections matched at IoU ≥ 0.5. It is a consistency measure, not accuracy: no ground-truth water labels were used.",
      };
      this.addEvent("ai", `Benchmark completed on ${this.detector.backend}: ${results.map((r) => `${r.inputSize}px ${r.p50Ms}ms`).join(" · ")}`, "ok");
      return this.benchmark;
    } catch (e) {
      this.pushNotice({ title: "Benchmark failed", body: (e as Error).message, tone: "error" });
      return null;
    } finally {
      this.benchmarkRunning = false;
      this.emit(true);
    }
  }

  /* ---------- evidence / snapshots ---------- */
  drawFrameWithOverlay(layers: { boxes: boolean; trails: boolean; zones: boolean; heat: boolean }, maxW = 1280) {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    const w = Math.min(maxW, v.videoWidth);
    c.width = w;
    c.height = Math.round((w * v.videoHeight) / v.videoWidth);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const s = this.settings;
    if (layers.heat) {
      this.pipeline.heatmap.render(
        ctx,
        c.width,
        c.height,
        s.heatmap.windowSeconds,
        sec(),
        s.heatmap.intensity,
        s.heatmap.opacity,
        s.heatmap.mode,
        s.heatmap.decayHalfLifeSeconds,
      );
    }
    if (layers.zones) drawZones(ctx, c.width, c.height, this.zones.filter((z) => z.enabled));
    if (layers.boxes || layers.trails) drawTracks(ctx, c.width, c.height, this.pipeline.tracker.confirmed(), sec(), layers, s.tracking.trailSeconds, this.pipeline.distress.levels, s.tracking.trailMaxGapSeconds);
    return c;
  }

  captureEvidence() {
    const raw = this.drawFrameWithOverlay({ boxes: false, trails: false, zones: false, heat: false });
    if (!raw || !this.isLive()) return null;
    const ann = this.drawFrameWithOverlay({ boxes: true, trails: true, zones: true, heat: false });
    return { original: raw.toDataURL("image/jpeg", 0.82), annotated: ann ? ann.toDataURL("image/jpeg", 0.82) : null };
  }

  resetHeatmap() {
    this.pipeline.heatmap.reset();
    this.heatCache.at = 0;
    this.addEvent("system", "Activity heat map reset");
  }

  resetTracking() {
    this.pipeline.reset();
    this.lastDetections = [];
    this.emit(true);
  }
}

function matchedDetections(ref: Detection[], other: Detection[]) {
  const used = new Set<number>();
  let n = 0;
  for (const a of ref) {
    let best = -1;
    let bestIou = 0.5;
    for (let i = 0; i < other.length; i++) {
      if (used.has(i)) continue;
      const v = boxIou(a.box, other[i].box);
      if (v > bestIou) {
        bestIou = v;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      n++;
    }
  }
  return n;
}

function boxIou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}


