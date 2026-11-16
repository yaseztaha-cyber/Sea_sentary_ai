"""Physical acoustic validation using the laptop microphone array.

This is NOT a digital loopback test. The microphone records sound through the
air from the physical Realtek speaker endpoint. Results separate:
  - full-volume siren + voice
  - reduced app volume
  - OS-level muted output (siren graph still runs; microphone should be quiet)
  - app-level muted output (playback must be refused)
  - browser autoplay-locked critical alert (no unlock gesture)

The microphone array is built into the same laptop, which is a limitation
recorded in the report. It is a separate input device from the speaker.
"""
from __future__ import annotations

import json
import pathlib
import threading
import time
import wave

import numpy as np
import soundcard as sc
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "evidence"
OUT.mkdir(parents=True, exist_ok=True)
SR = 48000


def save_wav(name: str, frames: np.ndarray):
    mono = frames.mean(axis=1) if frames.ndim > 1 else frames
    path = OUT / name
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mono, -1, 1) * 32767).astype("<i2").tobytes())
    return path, mono


def analyze(mono: np.ndarray, ambient_rms: float):
    win = int(SR * 0.1)
    rms = np.array([float(np.sqrt(np.mean(mono[i : i + win] ** 2) + 1e-12)) for i in range(0, len(mono) - win, win)])
    peak_rms = float(rms.max()) if len(rms) else 0.0
    threshold = max(ambient_rms * 1.8, 0.006)
    active = int(np.sum(rms > threshold))
    segments = []
    in_seg = False
    start = 0
    for i, v in enumerate(rms):
        on = v > threshold
        if on and not in_seg:
            start, in_seg = i, True
        elif not on and in_seg:
            if i - start >= 2:
                segments.append({"start_s": round(start * 0.1, 1), "end_s": round(i * 0.1, 1), "peak_rms": round(float(rms[start:i].max()), 4)})
            in_seg = False
    # dominant frequency in the loudest 0.5 s window (siren should be tonal)
    idx = int(np.argmax(rms)) if len(rms) else 0
    a = int(idx * 0.1 * SR)
    b = min(len(mono), a + int(0.5 * SR))
    dom = None
    if b - a > 1024:
        spec = np.abs(np.fft.rfft(mono[a:b] * np.hanning(b - a)))
        freqs = np.fft.rfftfreq(b - a, 1 / SR)
        band = (freqs > 200) & (freqs < 4000)
        if band.any():
            dom = round(float(freqs[band][np.argmax(spec[band])]), 1)
    return {
        "peak_rms_100ms": round(peak_rms, 4),
        "peak_amplitude": round(float(np.max(np.abs(mono))), 4),
        "active_100ms_windows": active,
        "segments": segments,
        "dominant_hz_loudest": dom,
        "above_ambient": peak_rms > max(ambient_rms * 1.8, 0.006),
    }


def record_while(seconds: float, action):
    result = {}
    mic = sc.default_microphone()

    def rec():
        with mic.recorder(samplerate=SR, channels=2) as r:
            result["frames"] = r.record(numframes=int(SR * seconds))

    th = threading.Thread(target=rec)
    th.start()
    time.sleep(0.6)
    action()
    th.join()
    return result["frames"]


def set_os_mute(muted: bool):
    # Run in its own process: Playwright/soundcard already initialized COM on
    # this thread with a different apartment model.
    import subprocess
    import sys
    code = (
        "from pycaw.pycaw import AudioUtilities\n"
        "import sys\n"
        "AudioUtilities.GetSpeakers().EndpointVolume.SetMute(int(sys.argv[1]), None)\n"
    )
    subprocess.run([sys.executable, "-c", code, "1" if muted else "0"], check=True)


def main():
    mic = sc.default_microphone()
    speaker = sc.default_speaker()
    print(f"acoustic path: {speaker.name} -> {mic.name}")

    # ambient reference
    with mic.recorder(samplerate=SR, channels=2) as r:
        ambient_frames = r.record(numframes=SR * 3)
    ambient_mono = ambient_frames.mean(axis=1)
    ambient_rms = float(np.sqrt(np.mean(ambient_mono**2)))
    print("ambient RMS", round(ambient_rms, 4))

    results = {"speaker": speaker.name, "microphone": mic.name, "sample_rate": SR, "ambient_rms": round(ambient_rms, 4), "tests": {}}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--autoplay-policy=no-user-gesture-required", "--window-position=-2000,-2000"])
        page = browser.new_page()
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        time.sleep(2)
        page.get_by_role("button", name="Enable alert audio").first.click()
        time.sleep(2)
        assert page.evaluate("window.__sentry.getSnapshot().audio.state") == "ready"
        page.evaluate("window.__sentry.alerts.setVolume(1.0)")

        # 1. full-volume siren + voice through the air
        def full_action():
            page.evaluate("async () => await window.__sentry.testSiren()")
            time.sleep(0.4)
            page.evaluate("async () => await window.__sentry.testVoice('North Beach')")

        frames = record_while(17, full_action)
        path, mono = save_wav("acoustic-full-volume.wav", frames)
        results["tests"]["full_volume_siren_voice"] = {"file": str(path.relative_to(ROOT)), **analyze(mono, ambient_rms)}
        time.sleep(1)

        # 2. reduced application volume
        page.evaluate("window.__sentry.alerts.setVolume(0.25)")
        frames = record_while(5.5, lambda: page.evaluate("async () => await window.__sentry.testSiren()"))
        path, mono = save_wav("acoustic-low-volume.wav", frames)
        results["tests"]["low_volume_siren"] = {"file": str(path.relative_to(ROOT)), **analyze(mono, ambient_rms)}
        page.evaluate("window.__sentry.alerts.setVolume(1.0)")
        time.sleep(0.5)

        # 3. OS-level output mute: the browser graph plays, the speaker is muted.
        set_os_mute(True)
        try:
            frames = record_while(5.5, lambda: page.evaluate("async () => await window.__sentry.testSiren()"))
            path, mono = save_wav("acoustic-os-muted.wav", frames)
            results["tests"]["os_muted_siren"] = {"file": str(path.relative_to(ROOT)), **analyze(mono, ambient_rms)}
        finally:
            set_os_mute(False)
        time.sleep(0.5)

        # 4. app-level mute must refuse playback.
        page.evaluate("window.__sentry.alerts.setMuted(true)")
        mute_res = page.evaluate("async () => await window.__sentry.testSiren()")
        frames = record_while(4, lambda: page.evaluate("async () => await window.__sentry.testSiren()"))
        path, mono = save_wav("acoustic-app-muted.wav", frames)
        results["tests"]["app_muted_siren"] = {"file": str(path.relative_to(ROOT)), "play_refused": mute_res is False, **analyze(mono, ambient_rms)}
        page.evaluate("window.__sentry.alerts.setMuted(false)")
        browser.close()

    # 5. browser autoplay-locked critical alert in a fresh context without unlock.
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--window-position=-2000,-2000"])
        page = browser.new_page()
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        time.sleep(2)
        frames = record_while(
            5.5,
            lambda: page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')"),
        )
        path, mono = save_wav("acoustic-browser-locked.wav", frames)
        s = page.evaluate("window.__sentry.getSnapshot()")
        results["tests"]["browser_locked_critical"] = {
            "file": str(path.relative_to(ROOT)),
            "audio_state": s["audio"]["state"],
            "active": s["audio"]["active"],
            "banner_visible": "AUDIBLE ALERT FAILED" in page.locator("body").inner_text(),
            **analyze(mono, ambient_rms),
        }
        page.screenshot(path=str(OUT / "browser-audio-locked.png"), full_page=False, animations="disabled")
        browser.close()

    OUT.joinpath("acoustic-validation.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
