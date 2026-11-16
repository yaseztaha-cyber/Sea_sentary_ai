"""Isolate the OS-output-muted acoustic test and verify the endpoint state."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import threading
import time
import wave

import numpy as np
import soundcard as sc
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "evidence"
SR = 48000
PY = sys.executable


def endpoint(action: str) -> str:
    code = (
        "from pycaw.pycaw import AudioUtilities\n"
        "v=AudioUtilities.GetSpeakers().EndpointVolume\n"
        f"action={action!r}\n"
        "if action=='mute': v.SetMute(1,None)\n"
        "elif action=='unmute': v.SetMute(0,None)\n"
        "print('muted' if v.GetMute() else 'unmuted')\n"
    )
    return subprocess.run([PY, "-c", code], capture_output=True, text=True, check=True).stdout.strip()


def record(seconds, action=None):
    mic = sc.default_microphone()
    box = {}

    def rec():
        with mic.recorder(samplerate=SR, channels=2) as r:
            box["f"] = r.record(numframes=int(SR * seconds))

    th = threading.Thread(target=rec)
    th.start()
    time.sleep(0.7)
    if action:
        action()
    th.join()
    return box["f"].mean(axis=1)


def rms_profile(mono):
    win = int(SR * 0.1)
    rms = np.array([float(np.sqrt(np.mean(mono[i : i + win] ** 2) + 1e-12)) for i in range(0, len(mono) - win, win)])
    return round(float(rms.max()), 4), round(float(np.mean(rms)), 4), [(round(i * 0.1, 1), round(float(v), 3)) for i, v in enumerate(rms) if v > 0.08][:8]


def main():
    print("endpoint", endpoint("state"))
    print("unmute", endpoint("unmute"))
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--autoplay-policy=no-user-gesture-required", "--window-position=-2000,-2000"])
        page = b.new_page()
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        time.sleep(2)
        page.get_by_role("button", name="Enable alert audio").first.click()
        time.sleep(2)
        page.evaluate("window.__sentry.alerts.setVolume(1.0)")
        ambient = record(3)
        print("ambient", rms_profile(ambient))
        print("mute", endpoint("mute"))
        muted = record(6, lambda: page.evaluate("async () => await window.__sentry.testSiren()"))
        print("muted playback", rms_profile(muted))
        with wave.open(str(OUT / "os-mute-isolated.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(muted, -1, 1) * 32767).astype("<i2").tobytes())
        print("unmute", endpoint("unmute"))
        page.evaluate("window.__sentry.alerts.stopAll('test complete')")
        b.close()


if __name__ == "__main__":
    main()
