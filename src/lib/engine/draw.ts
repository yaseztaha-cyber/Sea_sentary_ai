import type { Detection, Track } from "./types";
import type { Zone } from "@/lib/settings";
import type { TrackLevel } from "./distress";

export const COLORS = {
  mint: "#79DCC4",
  glass: "#A8D7C9",
  teal: "#26786F",
  coral: "#F17869",
  amber: "#E6B86C",
  moon: "#E7EEE8",
};

export const ZONE_COLORS: Record<Zone["type"], string> = {
  OBSERVATION: "#A8D7C9",
  SWIMMING: "#79DCC4",
  RESTRICTED: "#F17869",
  IGNORE: "#98ABA2",
};

export type OverlayLayers = { boxes: boolean; trails: boolean; zones: boolean };

export function drawZones(ctx: CanvasRenderingContext2D, w: number, h: number, zones: Zone[], opts: { labels?: boolean; draft?: { x: number; y: number }[]; draftColor?: string } = {}) {
  ctx.save();
  for (const z of zones) {
    if (z.points.length < 3) continue;
    const col = ZONE_COLORS[z.type];
    ctx.beginPath();
    z.points.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.closePath();
    ctx.globalAlpha = z.enabled ? 0.14 : 0.05;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = z.enabled ? 0.9 : 0.4;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(z.type === "IGNORE" || !z.enabled ? [5, 5] : []);
    ctx.stroke();
    if (opts.labels !== false) {
      ctx.setLineDash([]);
      ctx.globalAlpha = z.enabled ? 1 : 0.5;
      ctx.fillStyle = col;
      ctx.font = `500 ${Math.max(10, Math.round(w / 90))}px Manrope, sans-serif`;
      ctx.fillText(`${z.name} · ${z.type.toLowerCase()}`, z.points[0].x * w + 6, z.points[0].y * h - 6);
    }
  }
  if (opts.draft && opts.draft.length) {
    const col = opts.draftColor ?? COLORS.mint;
    ctx.globalAlpha = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    opts.draft.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    opts.draft.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

export function drawTracks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tracks: Track[],
  now: number,
  layers: { boxes: boolean; trails: boolean },
  trailSeconds: number,
  levels?: Map<number, TrackLevel>,
  maxGapSeconds = 0.9,
) {
  ctx.save();
  const fs = Math.max(10, Math.round(w / 100));
  for (const tr of tracks) {
    if (tr.hits < 2) continue;
    const lvl = levels?.get(tr.id)?.level ?? 1;
    const col = lvl === 4 ? COLORS.coral : lvl === 3 ? COLORS.amber : lvl === 2 ? COLORS.glass : COLORS.mint;
    const risk = lvl === 4 ? "CRITICAL" : lvl === 3 ? "SUSPECTED" : lvl === 2 ? "WATCH" : "";
    const lost = tr.state === "lost";
    if (layers.trails) {
      const pts = tr.history.filter((p) => now - p.t <= trailSeconds);
      for (let i = 1; i < pts.length; i++) {
        // Never bridge a tracking gap: a re-acquired track must not draw a
        // straight artificial line across the scene.
        if (pts[i].t - pts[i - 1].t > maxGapSeconds) continue;
        ctx.globalAlpha = (0.15 + 0.85 * (i / pts.length)) * (lost ? 0.5 : 1);
        ctx.strokeStyle = col;
        ctx.lineWidth = lvl >= 3 ? 2.6 : 2;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].cx * w, pts[i - 1].cy * h);
        ctx.lineTo(pts[i].cx * w, pts[i].cy * h);
        ctx.stroke();
      }
    }
    if (layers.boxes) {
      const b = tr.box;
      const x = b.x * w;
      const y = b.y * h;
      ctx.globalAlpha = lost ? 0.45 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = lvl >= 3 ? 3 : 2;
      ctx.setLineDash(lost ? [6, 5] : []);
      ctx.strokeRect(x, y, b.w * w, b.h * h);
      ctx.setLineDash([]);
      // consistent person-centre anchor used by tracking, trails, heat map and assessment
      ctx.beginPath();
      ctx.arc((b.x + b.w / 2) * w, (b.y + b.h / 2) * h, lvl >= 3 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      const label = `ID ${tr.id}${risk ? ` · ${risk}` : ""}${lost ? " · lost" : ` · ${Math.round(tr.score * 100)}%`}`;
      ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
      const tw = ctx.measureText(label).width + 10;
      const ly = Math.max(0, y - fs - 8);
      ctx.fillStyle = col;
      ctx.fillRect(x, ly, tw, fs + 8);
      ctx.fillStyle = "#061211";
      ctx.fillText(label, x + 5, ly + fs + 2);
    }
  }
  ctx.restore();
}

export function drawDetectionsOnly(ctx: CanvasRenderingContext2D, w: number, h: number, dets: Detection[]) {
  ctx.save();
  const fs = Math.max(10, Math.round(w / 100));
  for (const d of dets) {
    ctx.strokeStyle = COLORS.glass;
    ctx.lineWidth = 2;
    ctx.strokeRect(d.box.x * w, d.box.y * h, d.box.w * w, d.box.h * h);
    const label = `person ${Math.round(d.score * 100)}%`;
    ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
    const tw = ctx.measureText(label).width + 10;
    const ly = Math.max(0, d.box.y * h - fs - 8);
    ctx.fillStyle = COLORS.glass;
    ctx.fillRect(d.box.x * w, ly, tw, fs + 8);
    ctx.fillStyle = "#061211";
    ctx.fillText(label, d.box.x * w + 5, ly + fs + 2);
  }
  ctx.restore();
}
