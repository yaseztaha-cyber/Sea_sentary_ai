import type { Detection, Track } from "./types";
import type { FrameQuality, Settings, Zone } from "@/lib/settings";
import { Tracker } from "./tracker";
import { nmsDetections } from "./geometry";
import { HeatMapBank, trackAnchor } from "./heatmap";
import { TemporalDistressAnalyzer } from "./distress";

/**
 * The single live pipeline:
 * detections → tracker → track history → activity heat map → temporal
 * distress assessment → observations. Shared by the console and the landing
 * demo. No component invents detections.
 */
export class AnalysisPipeline {
  tracker: Tracker;
  heatmaps = new HeatMapBank();
  distress = new TemporalDistressAnalyzer();
  cameraKey = "default";
  private lastT: number | null = null;
  private lastZoneSig = "";

  constructor(settings: Settings) {
    this.tracker = new Tracker(settings.tracking, settings.inference.minScore);
  }

  get heatmap() {
    return this.heatmaps.get(this.cameraKey);
  }

  setCamera(key: string) {
    if (!key) key = "default";
    if (this.cameraKey !== key) {
      this.cameraKey = key;
      this.heatmaps.get(key);
      this.distress.setCamera(key);
    }
  }

  reset(keepHeat = false) {
    this.tracker.reset();
    if (!keepHeat) this.heatmaps.reset(this.cameraKey);
    this.distress.reset();
    this.lastT = null;
  }

  private syncZones(zones: Zone[], settings: Settings) {
    const sig = `${settings.heatmap.monitoredOnly}|` + zones.map((z) => `${z.id}:${z.enabled ? 1 : 0}:${z.type}:${z.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(";")}`).join("|");
    if (sig === this.lastZoneSig) return;
    this.lastZoneSig = sig;
    this.heatmap.setMonitoredZones(zones, settings.heatmap.monitoredOnly);
  }

  process(dets: Detection[], t: number, settings: Settings, zones: Zone[], wallClock: () => string, withAssessment = true, cameraKey?: string, frameQuality?: FrameQuality, acknowledgedTracks?: Set<number>) {
    if (cameraKey) this.setCamera(cameraKey);
    this.tracker.configure(settings.tracking, settings.inference.minScore);
    this.syncZones(zones, settings);
    const dt = this.lastT === null ? 0.15 : Math.min(2, t - this.lastT);
    this.lastT = t;
    // Suppress duplicate person boxes from the detector before association;
    // otherwise two near-identical boxes can split one swimmer into two IDs.
    const clean = nmsDetections(dets.filter((d) => d.score >= settings.tracking.lowScore), settings.tracking.duplicateIou ?? 0.55);
    const { expired, created } = this.tracker.update(clean, t);
    const confirmedNow: Track[] = [];
    for (const tr of this.tracker.tracks) {
      if (tr.state === "tracked" && tr.lastT === t) {
        const a = trackAnchor(tr.box);
        this.heatmap.add({
          x: a.x,
          y: a.y,
          dt: Math.min(0.6, Math.max(0.05, dt)),
          tSec: t,
          speed: tr.speed,
          stationarySeconds: tr.stationarySeconds,
        });
        if (tr.hits === settings.tracking.minHits) confirmedNow.push(tr);
      }
    }
    const result = withAssessment
      ? this.distress.evaluate({ tracks: this.tracker.tracks, zones, settings, now: t, wallClock, camera: this.cameraKey, frameQuality, acknowledgedTracks })
      : { assessments: [], observations: [] };
    return { expired, created, confirmedNow, observations: result.observations, assessments: result.assessments };
  }
}
