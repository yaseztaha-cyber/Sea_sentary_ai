import type { Box } from "./types";
import type { Pt } from "@/lib/settings";
import type { Detection } from "./types";

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Suppress duplicate boxes of the same class before association. */
export function nmsDetections(dets: Detection[], iouThreshold: number): Detection[] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) {
    if (keep.some((k) => k.classId === d.classId && iou(k.box, d.box) >= iouThreshold)) continue;
    keep.push(d);
  }
  return keep;
}
