"""Sustained real-time performance run (headed Chromium, hardware GPU path).

Measures actual capture FPS, detector/tracking rates, inference latency, frame
age, server CPU/RSS, browser process CPU/RSS (CDP process list + psutil) and
critical-alert latency. Saves raw samples and a summary under reports/.
"""
from __future__ import annotations

import json
import os
import pathlib
import statistics
import time

import psutil
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAM = ROOT / "test-artifacts" / "camera-5min-640.y4m"
OUT = ROOT / "reports"
OUT.mkdir(parents=True, exist_ok=True)
DURATION = int(os.environ.get("SENTRY_DURATION", "150"))
SAMPLE_EVERY = float(os.environ.get("SENTRY_SAMPLE_EVERY", "2.0"))
OUT_NAME = os.environ.get("SENTRY_OUT", "performance_run.json")
APP_URL = os.environ.get("SENTRY_APP_URL", "http://127.0.0.1:3000/app")


def pctl(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return round(s[min(len(s) - 1, int(len(s) * p))], 3)


def main():
    if not CAM.exists():
        raise SystemExit(f"missing {CAM}")
    samples = []
    alert_latency = None
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-video-capture={CAM}",
                "--autoplay-policy=no-user-gesture-required",
                "--window-position=-2000,-2000",
            ],
        )
        page = browser.new_page(viewport={"width": 1500, "height": 1000})
        page.set_default_timeout(180000)
        cdp = browser.new_browser_cdp_session()

        def browser_usage():
            procs = cdp.send("SystemInfo.getProcessInfo").get("processInfo", [])
            cpu = sum(float(x.get("cpuTime") or 0) for x in procs)
            rss = 0
            for x in procs:
                try:
                    rss += psutil.Process(int(x["id"])).memory_info().rss / 1048576
                except Exception:
                    pass
            return cpu, rss, len(procs)

        page.goto(APP_URL, wait_until="networkidle")
        page.get_by_role("button", name="Connect camera").first.click()
        time.sleep(2)
        page.get_by_role("button", name="Run AI").first.click()
        for _ in range(60):
            time.sleep(1)
            if page.evaluate("window.__sentry?.getSnapshot().ai.model === 'ready'"):
                break
        page.evaluate("async () => await window.__sentry.enableAlertAudio()")
        time.sleep(2)

        started = time.time()
        next_alert = started + 30
        alerted = False
        last_cpu, _, _ = browser_usage()
        last_cpu_at = time.time()
        while time.time() - started < DURATION:
            s = page.evaluate("window.__sentry.getSnapshot()")
            now = time.time()
            cpu_now, browser_rss, chrome_procs = browser_usage()
            browser_cpu = round((cpu_now - last_cpu) / max(0.5, now - last_cpu_at) / (psutil.cpu_count() or 8) * 100, 2)
            last_cpu, last_cpu_at = cpu_now, now
            samples.append(
                {
                    "t": round(now - started, 1),
                    "browser_cpu_percent": browser_cpu,
                    "browser_rss_mb": round(browser_rss),
                    "chrome_processes": chrome_procs,
                    "detections": s["ai"]["detections"],
                    "capture_fps": round(s["camera"]["captureFps"], 2),
                    "detector_rate": round(s["ai"]["detectorRate"], 3),
                    "tracking_rate": round(s["ai"]["trackingRate"], 3),
                    "latency_ms": round(s["ai"]["latencyMs"], 1),
                    "avg_latency_ms": round(s["ai"]["avgLatencyMs"], 1),
                    "p95_latency_ms": round(s["ai"]["p95LatencyMs"], 1),
                    "preprocess_ms": round(s["ai"]["preprocessMs"], 1),
                    "frame_age_ms": round(s["ai"]["queueDelayMs"], 1),
                    "server_cpu": s["perf"]["serverCpuPercent"],
                    "server_rss_mb": s["perf"]["serverRssMb"],
                    "system_used_mb": s["perf"]["systemUsedMb"],
                    "js_heap_mb": s["perf"]["jsHeapMb"],
                    "tracks": len(s["tracks"]),
                    "heat_samples": s["heatmap"]["samples"],
                    "alert_latency_ms": s["perf"]["alertLatencyMs"],
                    "provider": s["ai"]["backend"],
                    "input": s["ai"]["inputSize"],
                    "audio": s["audio"]["state"],
                }
            )
            if not alerted and time.time() >= next_alert:
                t0 = time.perf_counter()
                page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')")
                for _ in range(100):
                    a = page.evaluate("window.__sentry.getSnapshot().audio")
                    if a["active"] is not None:
                        break
                    time.sleep(0.05)
                alert_latency = round((time.perf_counter() - t0) * 1000, 1)
                alerted = True
                time.sleep(1)
                page.evaluate("window.__sentry.alerts.stopAll('sustained test')")
                for c in page.evaluate("window.__sentry.getSnapshot().critical"):
                    page.evaluate(
                        f"fetch('/api/incidents/{c['id']}', {{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{action:'false_alarm',note:'sustained performance test'}})}})"
                    )
            time.sleep(SAMPLE_EVERY)
        (OUT / "evidence").mkdir(exist_ok=True)
        page.screenshot(path=str(OUT / "evidence" / "monitoring-live.png"), full_page=False, animations="disabled")
        browser.close()

    lat = [x["avg_latency_ms"] for x in samples if x["avg_latency_ms"] > 0]
    p95 = [x["p95_latency_ms"] for x in samples if x["p95_latency_ms"] > 0]
    cap = [x["capture_fps"] for x in samples]
    det = [x["detector_rate"] for x in samples if x["detector_rate"] > 0]
    trk = [x["tracking_rate"] for x in samples if x["tracking_rate"] > 0]
    cpu = [x["server_cpu"] for x in samples if x["server_cpu"] is not None]
    rss = [x["server_rss_mb"] for x in samples if x["server_rss_mb"] is not None]
    heap = [x["js_heap_mb"] for x in samples if x["js_heap_mb"] is not None]
    bcpu = [x["browser_cpu_percent"] for x in samples[1:] if x["browser_cpu_percent"] is not None]
    brss = [x["browser_rss_mb"] for x in samples if x["browser_rss_mb"] is not None]
    frame_age = [x["frame_age_ms"] for x in samples]
    summary = {
        "duration_s": DURATION,
        "samples": len(samples),
        "source": "640×360 virtual camera @10 fps, demo beach scene",
        "provider": samples[-1]["provider"],
        "input_size": samples[-1]["input"],
        "capture_fps": {"p50": pctl(cap, 0.5), "p10": pctl(cap, 0.1), "min": round(min(cap), 2)},
        "detector_rate_per_s": {"p50": pctl(det, 0.5), "p10": pctl(det, 0.1), "mean": round(statistics.mean(det), 3)} if det else None,
        "tracking_rate_per_s": {"p50": pctl(trk, 0.5), "p10": pctl(trk, 0.1)} if trk else None,
        "avg_inference_latency_ms": {"p50": pctl(lat, 0.5), "p95": pctl(lat, 0.95), "max": round(max(lat), 1)} if lat else None,
        "snapshot_p95_latency_ms": {"p50": pctl(p95, 0.5), "max": round(max(p95), 1)} if p95 else None,
        "frame_age_ms": {"p50": pctl(frame_age, 0.5), "p95": pctl(frame_age, 0.95)} if frame_age else None,
        "server_cpu_percent": {"p50": pctl(cpu, 0.5), "max": round(max(cpu), 1)} if cpu else None,
        "browser_process_cpu_percent_of_logical_cores": {"p50": pctl(bcpu, 0.5), "p95": pctl(bcpu, 0.95), "max": round(max(bcpu), 1)} if bcpu else None,
        "browser_process_rss_mb": {"p50": pctl(brss, 0.5), "max": max(brss)} if brss else None,
        "detections_p50": pctl([x["detections"] for x in samples], 0.5),
        "server_rss_mb": {"p50": pctl(rss, 0.5), "max": max(rss)} if rss else None,
        "browser_js_heap_mb": {"p50": pctl(heap, 0.5), "max": max(heap)} if heap else None,
        "tracks": {"p50": pctl([x["tracks"] for x in samples], 0.5), "max": max(x["tracks"] for x in samples)},
        "heat_samples_final": samples[-1]["heat_samples"],
        "end_to_end_critical_alert_latency_ms": alert_latency,
        "post_to_incident_latency_ms": samples[-1]["alert_latency_ms"],
        "error_count": sum(1 for x in samples if x["capture_fps"] < 1),
        "measurement_note": "Browser CPU/RSS summed over the CDP process list for this Playwright browser only; 8 logical cores.",
    }
    (OUT / OUT_NAME).write_text(json.dumps({"summary": summary, "samples": samples}, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
