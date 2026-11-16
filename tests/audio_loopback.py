"""Verify that the siren and spoken alert physically reach the speaker path.

Uses WASAPI loopback capture (soundcard) of the default speaker while a real
headed Chromium plays a TEST critical alert. Saves the captured mix as WAV and
reports measurable audio segments. This test does not rely on the browser's
self-report.
"""
from __future__ import annotations

import json
import pathlib
import sys
import time
import wave

import numpy as np
import soundcard as sc
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAM = ROOT / "test-artifacts" / "camera-5min-640.y4m"
OUT = ROOT / "reports" / "evidence"
OUT.mkdir(parents=True, exist_ok=True)
SR = 48000
SECONDS = 16


def main() -> int:
    if not CAM.exists():
        print("missing camera y4m", file=sys.stderr)
        return 2
    speaker = sc.default_speaker()
    mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
    print(f"speaker={speaker.name} loopback={mic.name} samplerate={SR}")
    frames = None
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
        page = browser.new_page()
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        page.get_by_role("button", name="Connect camera").first.click()
        time.sleep(2)
        page.get_by_role("button", name="Run AI").first.click()
        for _ in range(60):
            time.sleep(1)
            if page.evaluate("window.__sentry?.getSnapshot().ai.model === 'ready'"):
                break
        page.get_by_role("button", name="Enable alert audio").first.click()
        time.sleep(2)
        assert page.evaluate("window.__sentry.getSnapshot().audio.state") == "ready"
        # Record at the same time as the browser plays the alert.
        with mic.recorder(samplerate=SR, channels=2) as rec:
            time.sleep(0.5)
            page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')")
            frames = rec.record(numframes=SR * SECONDS)
        page.evaluate("window.__sentry.alerts.stopAll('loopback test complete')")
        browser.close()

    assert frames is not None
    mono = frames.mean(axis=1) if frames.ndim > 1 else frames
    wav_path = OUT / "audio-loopback.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mono, -1, 1) * 32767).astype("<i2").tobytes())
    win = int(SR * 0.1)
    rms = np.array([float(np.sqrt(np.mean(mono[i : i + win] ** 2) + 1e-12)) for i in range(0, len(mono) - win, win)])
    peak = float(np.max(np.abs(mono)))
    rms_peak = float(np.max(rms))
    active = int(np.sum(rms > max(0.003, rms_peak * 0.1)))
    segments = []
    in_seg = False
    start = 0
    for i, v in enumerate(rms):
        on = v > max(0.003, rms_peak * 0.1)
        if on and not in_seg:
            start = i
            in_seg = True
        elif not on and in_seg:
            if i - start >= 3:
                segments.append({"start_s": round(start * 0.1, 1), "end_s": round(i * 0.1, 1), "peak_rms": round(float(np.max(rms[start:i])), 4)})
            in_seg = False
    report = {
        "speaker": speaker.name,
        "loopback": mic.name,
        "sample_rate": SR,
        "seconds_captured": SECONDS,
        "peak_amplitude": round(peak, 4),
        "peak_rms_100ms": round(rms_peak, 4),
        "active_100ms_windows": active,
        "segments": segments,
        "verdict": "audible output captured" if rms_peak > 0.003 else "NO AUDIBLE OUTPUT CAPTURED (check OS mute/volume/device)",
        "wav": str(wav_path.relative_to(ROOT)),
    }
    (OUT / "audio-loopback.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if rms_peak > 0.003 else 1


if __name__ == "__main__":
    raise SystemExit(main())
