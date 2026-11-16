"""Physical USB camera validation for Sea Sentry AI.

No fake-device flags are used. The script enumerates real video inputs, selects
the HP Webcam explicitly, runs the existing live pipeline, and records real
measurements. If the camera is busy or produces an unusable frame, it reports
BLOCKED and writes the exact error instead of substituting a virtual camera.

Prerequisite:
  - PostgreSQL and the app are running (launch.bat)
  - the physical camera is not held by another application
  - the scene has one person; repeat with multiple people / occlusion / lighting

Usage:
  python tests/physical_camera_validation.py --seconds 90
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "evidence"
OUT.mkdir(parents=True, exist_ok=True)


def pctl(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return round(s[min(len(s) - 1, int(len(s) * p))], 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=90)
    ap.add_argument("--device-name", default="HP Webcam")
    args = ap.parse_args()
    result = {"source": "physical camera", "requested": args.device_name, "blocked": False}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        time.sleep(2)
        devices = page.evaluate(
            "navigator.mediaDevices.enumerateDevices().then(ds=>ds.filter(d=>d.kind==='videoinput').map(d=>({id:d.deviceId,label:d.label})))"
        )
        result["devices"] = devices
        target = next((d for d in devices if args.device_name.lower() in (d["label"] or "").lower()), None)
        if not target:
            result.update({"blocked": True, "error": f"{args.device_name} not present in enumerateDevices"})
            page.screenshot(path=str(OUT / "physical-camera-blocked.png"), full_page=False)
            browser.close()
            (OUT / "physical-camera-validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result, indent=2))
            return 2
        result["device"] = target
        page.evaluate(f"window.__sentry.connect({json.dumps(target['id'])})")
        for _ in range(12):
            time.sleep(1)
            cam = page.evaluate("window.__sentry.getSnapshot().camera")
            if cam["state"] in ("connected", "error"):
                break
        result["camera"] = cam
        if cam["state"] != "connected" or not cam["live"]:
            result.update({"blocked": True, "error": cam.get("error") or "no live physical frames"})
            page.screenshot(path=str(OUT / "physical-camera-blocked.png"), full_page=False, animations="disabled")
            browser.close()
            (OUT / "physical-camera-validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result, indent=2))
            return 2

        page.get_by_role("button", name="Run AI").first.click()
        for _ in range(60):
            time.sleep(1)
            if page.evaluate("window.__sentry.getSnapshot().ai.model === 'ready'"):
                break
        # Wait for real inference frames so detector/tracking rates are meaningful
        # even when the scene contains no person.
        for _ in range(30):
            time.sleep(1)
            ai = page.evaluate("window.__sentry.getSnapshot().ai")
            if ai["inferenceFrames"] > 2 and ai["detectorRate"] > 0:
                break
        samples = []
        start = time.time()
        while time.time() - start < args.seconds:
            s = page.evaluate("window.__sentry.getSnapshot()")
            samples.append(
                {
                    "t": round(time.time() - start, 1),
                    "capture_fps": s["camera"]["captureFps"],
                    "detector_rate": s["ai"]["detectorRate"],
                    "tracking_rate": s["ai"]["trackingRate"],
                    "latency_ms": s["ai"]["latencyMs"],
                    "p95_latency_ms": s["ai"]["p95LatencyMs"],
                    "drops": s["camera"]["drops"],
                    "tracks": [{"id": t["id"], "state": t["state"], "age": t["ageS"], "zone": t["zone"]} for t in s["tracks"]],
                    "heat_samples": s["heatmap"]["samples"],
                    "heat_live": s["heatmap"]["live"],
                    "provider": s["ai"]["backend"],
                }
            )
            time.sleep(2)
        page.screenshot(path=str(OUT / "physical-camera-live.png"), full_page=False, animations="disabled")

        # Reconnect test on the physical device.
        frames_before = page.evaluate("window.__sentry.getSnapshot().camera.frames")
        page.evaluate("window.__sentry.disconnect()")
        time.sleep(2)
        disconnected = page.evaluate("window.__sentry.getSnapshot().camera")
        page.evaluate("window.__sentry.reconnect()")
        time.sleep(4)
        reconnected = page.evaluate("window.__sentry.getSnapshot().camera")
        frames_after_a = reconnected["frames"]
        time.sleep(3)
        reconnected = page.evaluate("window.__sentry.getSnapshot().camera")
        frames_after_b = reconnected["frames"]
        ids = sorted({t["id"] for s in samples for t in s["tracks"]})
        result.update(
            {
                "seconds": args.seconds,
                "capture_fps": {"p50": pctl([s["capture_fps"] for s in samples], 0.5), "min": min(s["capture_fps"] for s in samples)},
                "camera_width": cam["width"], "camera_height": cam["height"], "camera_reported_fps": cam.get("actualFps"),
                "detector_rate": {"p50": pctl([s["detector_rate"] for s in samples], 0.5)},
                "tracking_rate": {"p50": pctl([s["tracking_rate"] for s in samples], 0.5)},
                "latency_ms": {"p50": pctl([s["latency_ms"] for s in samples], 0.5), "p95": pctl([s["p95_latency_ms"] for s in samples], 0.95)},
                "dropped_frames": samples[-1]["drops"],
                "track_ids_seen": ids,
                "heat_samples": samples[-1]["heat_samples"],
                "provider": samples[-1]["provider"],
                "ai_start_state": page.evaluate("window.__sentry.getSnapshot().ai.model"),
                "disconnect": {"state": disconnected["state"], "frames": disconnected["frames"]},
                "reconnect": {"state": reconnected["state"], "frames": reconnected["frames"], "width": reconnected["width"], "height": reconnected["height"]},
                "reconnected": reconnected["state"] == "connected" and reconnected["width"] > 0 and frames_after_b > frames_after_a,
                "reconnect_frames": {"after_4s": frames_after_a, "after_7s": frames_after_b},
                "samples": samples,
            }
        )
        (OUT / "physical-camera-validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({k: v for k, v in result.items() if k != "samples"}, indent=2))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
