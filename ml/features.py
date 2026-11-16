"""Temporal feature extraction for the swimmer-distress sequence workflow.

Input schema (JSON):
{
  "sessions": [
    {
      "id": "pool_session_001",
      "source": "pool-cam-a",
      "label": "normal" | "distress",
      "split": "train" | "val" | "test",       # optional; grouped assignment if absent
      "event_start": 12.0, "event_end": 27.0, # optional, seconds within the session
      "license": "CC BY 4.0", "url": "https://...",
      "frames": [
        {"t": 0.0, "tracks": [
          {"id": 1, "x": 0.42, "y": 0.55, "w": 0.05, "h": 0.12, "score": 0.91, "visible": true}
        ]}
      ]
    }
  ]
}

`x,y` are the normalized person-centre anchor. This matches the live pipeline's
tracker output. The script produces window-level feature rows; labels are
positive when the window overlaps the labeled distress event, otherwise the
session label applies. Sessions are never split by frame.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

FEATURE_NAMES = [
    "samples",
    "window_seconds",
    "path_length",
    "net_displacement",
    "tortuosity",
    "direction_reversals",
    "low_speed_seconds",
    "stalled_seconds",
    "mean_speed",
    "recent_speed",
    "prior_speed",
    "speed_ratio",
    "median_aspect",
    "aspect_std",
    "submersion_events",
    "longest_submersion",
    "stationary_seconds",
    "track_age_seconds",
]

STILL_STEP = 0.008
MIN_STEP = 0.004


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[len(s) // 2]


def track_features(points: list[dict[str, Any]], now: float, window: float = 20.0, context: float = 60.0, immobility_speed: float = 0.012) -> dict[str, float]:
    pts = [p for p in points if p["t"] <= now and now - p["t"] <= window + 0.2]
    prior = [p for p in points if p["t"] <= now and window + 0.2 < now - p["t"] <= context]
    if len(pts) < 4:
        return {}
    path = 0.0
    reversals = 0
    low_speed = 0.0
    stalled = 0.0
    prev_heading = None
    aspects = []
    for i, p in enumerate(pts):
        aspects.append(p["h"] / max(0.001, p["w"]))
        if i == 0:
            continue
        q = pts[i - 1]
        dt = max(0.03, p["t"] - q["t"])
        dx, dy = p["x"] - q["x"], p["y"] - q["y"]
        step = math.hypot(dx, dy)
        path += step
        speed = step / dt
        if speed < immobility_speed:
            low_speed += dt
        if speed < STILL_STEP:
            stalled += dt
        if step > MIN_STEP:
            heading = math.atan2(dy, dx)
            if prev_heading is not None:
                d = abs(heading - prev_heading)
                if d > math.pi:
                    d = 2 * math.pi - d
                if d > (2 * math.pi) / 3:
                    reversals += 1
            prev_heading = heading
    net = math.hypot(pts[-1]["x"] - pts[0]["x"], pts[-1]["y"] - pts[0]["y"])
    span = max(0.001, pts[-1]["t"] - pts[0]["t"])
    mean_speed = path / span
    recent = pts[-max(3, len(pts) // 2) :]
    recent_path = sum(math.hypot(recent[i]["x"] - recent[i - 1]["x"], recent[i]["y"] - recent[i - 1]["y"]) for i in range(1, len(recent)))
    recent_span = max(0.001, recent[-1]["t"] - recent[0]["t"])
    recent_speed = recent_path / recent_span
    prior_path = sum(math.hypot(prior[i]["x"] - prior[i - 1]["x"], prior[i]["y"] - prior[i - 1]["y"]) for i in range(1, len(prior)))
    prior_span = max(0.001, prior[-1]["t"] - prior[0]["t"]) if len(prior) > 1 else 0
    prior_speed = prior_path / prior_span if prior_span else 0.0
    gaps = [g for g in points if g.get("gap_seconds")]
    recent_gaps = [g["gap_seconds"] for g in gaps if g["t"] <= now and now - g["t"] <= context and g["gap_seconds"] >= 1.1]
    return {
        "samples": len(pts),
        "window_seconds": span,
        "path_length": path,
        "net_displacement": net,
        "tortuosity": path / max(net, 0.02),
        "direction_reversals": reversals,
        "low_speed_seconds": low_speed,
        "stalled_seconds": stalled,
        "mean_speed": mean_speed,
        "recent_speed": recent_speed,
        "prior_speed": prior_speed,
        "speed_ratio": recent_speed / prior_speed if prior_speed > 0.01 else 1.0,
        "median_aspect": _median(aspects),
        "aspect_std": (sum((a - sum(aspects) / len(aspects)) ** 2 for a in aspects) / len(aspects)) ** 0.5,
        "submersion_events": len(recent_gaps),
        "longest_submersion": max(recent_gaps) if recent_gaps else 0.0,
        "stationary_seconds": stalled,
        "track_age_seconds": now - points[0]["t"],
    }


@dataclass
class WindowRow:
    session_id: str
    split: str
    label: int
    t: float
    features: dict[str, float]


def session_windows(session: dict[str, Any], window: float = 20.0, stride: float = 2.0) -> list[WindowRow]:
    frames = sorted(session.get("frames", []), key=lambda f: f["t"])
    if not frames:
        return []
    by_track: dict[int, list[dict[str, Any]]] = {}
    for f in frames:
        for tr in f.get("tracks", []):
            if not tr.get("visible", True):
                continue
            by_track.setdefault(int(tr["id"]), []).append(
                {
                    "t": float(f["t"]),
                    "x": float(tr["x"]),
                    "y": float(tr["y"]),
                    "w": float(tr["w"]),
                    "h": float(tr["h"]),
                    "score": float(tr.get("score", 0.0)),
                    "gap_seconds": tr.get("gap_seconds"),
                }
            )
    label = 1 if session.get("label") == "distress" else 0
    event_start = session.get("event_start")
    event_end = session.get("event_end")
    rows: list[WindowRow] = []
    end_t = frames[-1]["t"]
    t = window
    while t <= end_t + 0.01:
        for _tid, pts in by_track.items():
            feat = track_features(pts, t, window)
            if not feat:
                continue
            if event_start is not None and event_end is not None:
                y = int(t >= float(event_start) and t - window <= float(event_end))
            else:
                y = label
            rows.append(WindowRow(str(session["id"]), str(session.get("split", "")), y, t, feat))
        t += stride
    return rows


def extract(doc: dict[str, Any]) -> list[WindowRow]:
    rows: list[WindowRow] = []
    for session in doc.get("sessions", []):
        rows.extend(session_windows(session))
    return rows
