"""End-to-end verification against the real running app with a virtual camera.

Covers: real tracking → heatmap samples, heatmap mode switch, WATCH never
triggering audio, audio unlock, siren signal, spoken zone, critical incident
creation, duplicate suppression, acknowledgment (siren stops, incident stays
open), and the visible audible-alert failure state.

Run after `npm run build` + `npm start` and with Chromium's fake webcam file:
  python tests/e2e_audio_critical.py
"""
from __future__ import annotations

import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAM = ROOT / "test-artifacts" / "camera-5min-640.y4m"
OUT = ROOT / "reports" / "evidence"
OUT.mkdir(parents=True, exist_ok=True)


def wait_for(page, predicate_js: str, timeout: float = 60, interval: float = 1.0):
    end = time.time() + timeout
    while time.time() < end:
        value = page.evaluate(predicate_js)
        if value:
            return value
        time.sleep(interval)
    raise AssertionError(f"timed out waiting for: {predicate_js}")


def snap(page):
    return page.evaluate("window.__sentry.getSnapshot()")


def main() -> int:
    if not CAM.exists():
        print(f"missing virtual camera file: {CAM}", file=sys.stderr)
        return 2
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-video-capture={CAM}",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.set_default_timeout(120000)
        page.goto("http://127.0.0.1:3000/app", wait_until="networkidle")
        page.get_by_role("button", name="Connect camera").first.click()
        time.sleep(2)
        page.get_by_role("button", name="Run AI").first.click()
        wait_for(page, "window.__sentry && window.__sentry.getSnapshot().ai.model === 'ready'", 75)
        wait_for(page, "window.__sentry.getSnapshot().ai.tracked > 0", 75)
        page.get_by_role("tab", name="Occupancy").first.click()
        wait_for(page, "window.__sentry.getSnapshot().heatmap.samples > 0 && window.__sentry.getSnapshot().heatmap.activeCells > 0", 30)
        time.sleep(4)

        s = snap(page)
        assert s["heatmap"]["samples"] > 0, "heatmap must receive real track samples"
        assert s["heatmap"]["activeCells"] > 0, "heatmap must have active cells"
        assert s["heatmap"]["lastSampleAgeMs"] is not None and s["heatmap"]["lastSampleAgeMs"] < 6000, "heatmap samples must be recent"
        results.append(("tracking-driven heatmap", f"samples={s['heatmap']['samples']} cells={s['heatmap']['activeCells']} tracks={len(s['tracks'])}"))
        assert len(s["tracks"]) >= 1
        assert s["tracks"][0]["id"] >= 1

        # Switch Occupancy → Movement via the interface.
        page.get_by_role("tab", name="Movement").first.click()
        time.sleep(1)
        assert snap(page)["settings"]["heatmap"]["mode"] == "movement"
        results.append(("heatmap modes", "occupancy → movement via UI"))

        # Audio unlock (operator gesture).
        page.get_by_role("button", name="Enable alert audio").first.click()
        wait_for(page, "window.__sentry.getSnapshot().audio.state === 'ready'", 15)
        results.append(("audio unlock", "AudioContext running, voice listed"))

        # Siren test: measure real signal in the Web Audio graph.
        siren_ok = False
        for _attempt in range(2):
            page.get_by_role("button", name="Test siren").first.click()
            wait_for(page, "window.__sentry.getSnapshot().audio.lastPlayback && window.__sentry.getSnapshot().audio.lastPlayback.ref === 'TEST SIREN' && window.__sentry.getSnapshot().audio.active === null", 25)
            a = snap(page)["audio"]
            if a["lastPlayback"] and a["lastPlayback"]["sirenPlayed"]:
                siren_ok = True
                break
            time.sleep(1)
        assert siren_ok, snap(page)["audio"]
        assert a["lastPlayback"]["signalPeak"] > 0.001, a["lastPlayback"]
        results.append(("siren", f"played, signal peak={a['lastPlayback']['signalPeak']}"))

        # Voice test with the real configured zone.
        ok = False
        for _attempt in range(2):
            page.evaluate("async () => await window.__sentry.testVoice('North Beach')")
            wait_for(page, "window.__sentry.getSnapshot().audio.lastPlayback && window.__sentry.getSnapshot().audio.lastPlayback.ref === 'TEST VOICE'", 20)
            a = snap(page)["audio"]
            assert "North Beach" in (a["lastPlayback"]["spokenText"] or ""), a["lastPlayback"]
            if a["lastPlayback"]["voicePlayed"]:
                ok = True
                break
            time.sleep(2)
        assert ok, snap(page)["audio"]
        results.append(("spoken voice", "local speechSynthesis played; zone included"))

        # WATCH-level observation must never create audio.
        before = snap(page)["audio"]["lastPlayback"]
        page.evaluate("async () => await window.__sentry.raiseTestObservation(3, 'North Beach')")
        time.sleep(3)
        s = snap(page)
        assert s["audio"]["lastPlayback"] == before, "WATCH must not trigger audio"
        assert s["audio"]["active"] is None
        results.append(("WATCH no siren", "no playback or active alert"))

        # Critical incident: siren + spoken zone + persistent banner.
        page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')")
        wait_for(page, "window.__sentry.getSnapshot().critical.some(c => c.severity === 'CRITICAL' && c.status === 'NEW')", 20)
        wait_for(page, "window.__sentry.getSnapshot().audio.lastPlayback && window.__sentry.getSnapshot().audio.lastPlayback.finishedAt !== null", 35)
        s = snap(page)
        crit = [c for c in s["critical"] if c["severity"] == "CRITICAL" and c["status"] == "NEW"][-1]
        pb = s["audio"]["lastPlayback"]
        assert pb and pb["incidentId"] == crit["id"], (pb, crit)
        assert pb["sirenPlayed"] is True, pb
        assert pb["voicePlayed"] is True, pb
        assert "North Beach" in (pb["spokenText"] or ""), pb
        assert crit["zoneName"] == "North Beach"
        assert s["audio"]["active"] is None
        page.screenshot(path=str(OUT / "critical-banner.png"), full_page=False, animations="disabled")
        results.append(("critical alert", f"{crit['ref']} siren+voice, zone={crit['zoneName']}"))

        # Duplicate announcements for the same incident are refused.
        dup = page.evaluate(
            f"window.__sentry.alerts.announce({{incidentId:{crit['id']},ref:'{crit['ref']}',zone:'X',at:new Date().toISOString()}})"
        )
        assert dup["queued"] is False
        results.append(("duplicate suppression", dup.get("reason", "")))

        # Close the first verified incident so the next TEST observation creates a
        # distinct incident instead of grouping into the same open one.
        page.evaluate(
            f"fetch('/api/incidents/{crit['id']}', {{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{action:'false_alarm',note:'E2E first alert verified'}})}})"
        )
        time.sleep(1.5)

        # Acknowledge while a second critical siren is playing: stops audio, keeps incident open.
        page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')")
        time.sleep(1.5)
        s = snap(page)
        assert s["audio"]["active"] is not None, "second critical should be playing"
        new_id = s["audio"]["active"]["incidentId"]
        page.get_by_role("button", name="Acknowledge (silence siren)").first.click()
        time.sleep(2)
        s = snap(page)
        acked = [c for c in s["critical"] if c["id"] == new_id][0]
        assert acked["status"] == "ACKNOWLEDGED"
        assert s["audio"]["active"] is None
        assert s["audio"]["state"] == "ready", s["audio"]
        # still open in the API?
        rows = page.evaluate("fetch('/api/incidents?status=NEW,ACKNOWLEDGED,UNDER_REVIEW').then(r=>r.json())")
        assert any(r["id"] == new_id for r in rows), "acknowledgment must not resolve/close the incident"
        results.append(("acknowledge", "siren stopped, audio ready, incident remains open"))

        # Two simultaneous critical announcements must never overlap.
        q = page.evaluate(
            """() => {
              const a = window.__sentry.alerts;
              const r1 = a.announce({incidentId:-101,ref:'QUEUE-1',zone:'North Beach',at:new Date().toISOString()});
              const r2 = a.announce({incidentId:-102,ref:'QUEUE-2',zone:'North Beach',at:new Date().toISOString()});
              const s = a.getStatus();
              return {r1,r2,active:s.active,queued:s.queued};
            }"""
        )
        assert q["r1"]["queued"] and q["r2"]["queued"], q
        assert q["active"] is not None and q["queued"] >= 1, q
        page.evaluate("window.__sentry.alerts.stopAll('queue test complete')")
        results.append(("multi-incident queue", f"one active + {q['queued']} queued, never overlapping"))

        # Audio failure is visible, not silently claimed as played.
        page.evaluate("window.__sentry.applySettingsLocal(s => { s.alerts.audioEnabled = false; }); window.__sentry.alerts.stopAll('test');")
        page.evaluate("async () => await window.__sentry.raiseTestObservation(4, 'North Beach')")
        time.sleep(3)
        s = snap(page)
        assert s["audio"]["state"] in ("muted", "error"), s["audio"]
        assert any(n["title"].startswith("Audible alert not played") for n in s["notices"]), s["notices"]
        assert "AUDIBLE ALERT FAILED" in page.locator("body").inner_text()
        results.append(("audio failure visibility", "disabled audio surfaced as failure notice + banner"))

        # Restore and resolve this run's test incidents.
        page.evaluate("window.__sentry.applySettingsLocal(s => { s.alerts.audioEnabled = true; })")
        open_rows = page.evaluate("fetch('/api/incidents?status=NEW,ACKNOWLEDGED,UNDER_REVIEW').then(r=>r.json())")
        for row in open_rows:
            if row["isTest"]:
                page.evaluate(
                    f"fetch('/api/incidents/{row['id']}', {{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{action:'false_alarm',note:'E2E verification complete'}})}})"
                )
        browser.close()

    print(json.dumps(results, indent=1))
    (ROOT / "reports" / "e2e_results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
