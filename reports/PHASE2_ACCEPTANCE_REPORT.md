# Phase 2 acceptance report — hardware and safety validation

Date: 2026-11-14/15 · Host: Windows 11 Pro 10.0.26100 · Intel i7-6820HQ · 16 GB RAM · no NVIDIA/CUDA.

This report separates what was actually verified from what remains unverified. It does not claim rescue readiness.

## 1. Physical hardware inventory

| Device | Evidence | Status |
| --- | --- | --- |
| HP Webcam (USB `VID_04CA&PID_707D`) | Windows PnP: Camera, Status OK, `USB\VID_04CA&PID_707D&MI_00` | Present |
| OBS Virtual Camera | Chromium `enumerateDevices` videoinput | Present; **virtual**; was the system default and emitted the green placeholder |
| Realtek Speakers / Headphones | Windows AudioEndpoint + soundcard default speaker | Present |
| Microphone Array (Realtek) | Windows AudioEndpoint + soundcard default microphone | Present |

### The green preview

The green frame is **not** the Sea Sentry heat map and not a thermal sensor. It was the **OBS Virtual Camera**, which Chromium selected as the system-default video input. The app now has **Settings → Camera source** with a real device picker, marks virtual devices in that list, shows a **“VIRTUAL CAMERA SOURCE — this is not a physical-camera feed”** warning when a virtual source is active, and **prefers a non-virtual video input automatically**. After that change the HP Webcam opened at 640×480 (30 fps reported) and real frames were captured. Evidence: device inventory above; green frame observed in the session; `reports/evidence/physical-camera-frame.png` is the later camera-error state, not a substitute for the green observation.

## 2. Physical camera validation — PARTIALLY VERIFIED

The HP Webcam was initially held by another application (`NotReadableError: Device in use`; OpenCV returned a black 640×480 frame). After the competing camera session released it, the app automatically preferred the physical HP Webcam and opened a real stream:

- Actual stream: **640×480, 30 fps reported by the device**.
- 30 s physical run: measured capture **p50 7.57 fps**, detector/tracking **5.945/s**, inference **p50 69.5 ms / p95 384.6 ms**, **45 dropped frames**, **87 heat samples**, **track IDs 1 and 2** observed.
- One person (the operator, partially framed / face and shoulders only) was detected and tracked. This is the **one-person, partial-framing** condition.
- Reconnect test: disconnect → connected again at 640×480; frame count increased from 4 to 6 over 3 s. `reconnected: true` in `reports/evidence/physical-camera-validation.json`.
- A later 60 s attempt completed camera capture but produced **zero detector/tracking samples despite model state “ready”**; another short manual run immediately afterward produced 1 detection, 1 track, ~6 inferences/s and ~58 ms latency. This instability is recorded as a failure, not hidden.
- Stored screenshot of the person is **redacted** (`reports/evidence/physical-camera-live-redacted.png`); the raw face frame was deleted.

Not tested: **multiple people**, **deliberate occlusion**, **varied/changing lighting**, long-duration (>60 s) physical tracking stability. Track ID stability was **not clean** (IDs 1 and 2 in 30 s), so no claim of stable identity is made. Run `python tests/physical_camera_validation.py --seconds 90` with the required scene conditions to extend this evidence.

## 3. Acoustic alert validation — PHYSICAL OUTPUT VERIFIED

Path: app → Realtek speaker → air → **laptop microphone array** → WAV. This is **not** a digital loopback. The microphone is a separate input device, but it is built into the same laptop; no independent phone/external recorder was available. This limitation matters.

Tests:

| Test | Acoustic measurement | Result |
| --- | --- | --- |
| Ambient | RMS 0.041 | noise reference |
| Full volume siren + voice | peak 100 ms RMS **0.2609**, peak amplitude 0.658; siren 650–950 Hz band **44.52**; speech interval RMS **0.1253**, 300–3000 Hz band **55.63**; tail RMS 0.0339 | siren and speech clearly above ambient |
| App volume 0.25 | peak RMS **0.2026**; siren band 32.44 | quieter but audible; not a linear 4× drop (mic AGC/room noise) |
| OS endpoint muted | siren band **1.70** vs 44.52 full (≈26× lower) | no siren above noise; OS mute works |
| App muted | `testSiren()` refused; siren band 1.94 | app-level mute blocks playback |
| Browser not unlocked | no `AudioContext` gesture; state not ready; active null; banner **AUDIBLE ALERT FAILED / NOT PLAYED**; siren band 1.66 | no audible alert; failure visible |

Evidence:
- `reports/evidence/acoustic-full-volume.wav`
- `reports/evidence/acoustic-low-volume.wav`
- `reports/evidence/acoustic-os-muted.wav`
- `reports/evidence/acoustic-app-muted.wav`
- `reports/evidence/acoustic-browser-locked.wav`
- `reports/evidence/acoustic-validation.json`
- `reports/evidence/acoustic-band-analysis.json`
- `reports/evidence/browser-audio-locked.png`

Not testable on this host:
- **Disconnected output device**: no safe way to detach the only endpoint in a non-admin session.
- **Wrong output device**: only one physical output endpoint (`Speakers / Headphones (2- Realtek Audio)`) was exposed; there was no second sink to select.
- **External/independent recorder**: unavailable; the internal mic is not a substitute for a phone recording in a noisy room.

Queue, deduplication, acknowledgment and repeat behavior were re-tested through the existing E2E (`tests/e2e_audio_critical.py`, 11 checks PASS) on a virtual camera. Those controller results are independent of the physical speaker path.

## 4. Distress screening validation — NOT VALIDATED

No licensed, session-labelled video corpus was available with both normal swimming and genuine distress. Therefore **no precision, recall, F1, confusion matrix, false alarms/hour, missed-event count, or per-condition validation is reported.** This is deliberate: manufacturing those numbers would be false evidence.

The existing temporal engine remains labelled **EXPERIMENTAL — HUMAN REVIEW REQUIRED**; its scores are `unvalidated-heuristic`, and `modelConfidence` is `null`. The 23 unit tests exercise logic only (normal swimming, floating, single dive, persistence, multi-indicator CRITICAL, zone cap) and are not real-world validation. The ML workflow (`ml/train_temporal.py`) refuses to train without a licensed session-level sequence file.

Sources reviewed and rejected/limited: Figshare underwater image set (CC BY 4.0, no session boundaries), Kaggle infant-swimming videos (unknown licence), Roboflow image export (no source sessions), IET Pool (on request), ODIV (redistribution restrictions), MOBDrone (different task). Full detail: `reports/DATASET_REVIEW.md`.

## 5. Live reliability — PHYSICAL + VIRTUAL

Physical camera (30 s, one person, partial framing): capture p50 **7.57 fps** (device reports 30 fps), detector/tracking **5.945/s**, inference p50 **69.5 ms** / p95 **384.6 ms**, **45 dropped frames**, **87 heat samples**, **2 track IDs**. Reconnect recovered. A 60 s repeat produced no active inference samples despite “ready” state — recorded as a reliability failure.

The following are **virtual-camera/test-fixture** results and remain valid only for the software pipeline:

| Measurement | Virtual result |
| --- | --- |
| Duration | 150 s, 640×360 @10 fps Y4M |
| Capture FPS | p50 9.67, p10 5.88 |
| Detector / tracking | p50 5.78 / 5.78 per s |
| Inference latency | p50 89.9 ms, p95 145.4 ms |
| Frame age | p50 46.8 ms, p95 95.9 ms |
| Dropped frames | latest-frame policy; 0 capture errors |
| Browser CPU / RSS | p50 18.6% of 8 logical cores / 1,019 MB |
| Server CPU / RSS | p50 0.1% / 87 MB |
| Heatmap alignment | virtual peak 0.045 normalized from track anchor, within splat radius; 149 active cells, 7 samples |
| Critical alert latency | 0.34–3.46 s across runs (TEST path; includes persistence + dispatch + audio start) |
| Virtual reconnect | disconnect → state disconnected; reconnect → state connected (frame count increased by 1 immediately; capture continuity not fully proven) |

Raw: `reports/performance_run.json`, `reports/evidence/heatmap-alignment-virtual.json`, `reports/evidence/virtual-reconnect.json`.

Physical heatmap peak-vs-track alignment, multiple-person stability, lighting changes and long-duration physical operation are **not measured**. The physical reconnect result is state/frame based; a literal USB unplug/replug was not performed.

## 6. Acceptance matrix

| Area | Status |
| --- | --- |
| Physical camera detection | **PARTIALLY VERIFIED** — real 640×480 HP Webcam stream, one person, partial framing |
| Physical scene coverage (multiple people, deliberate occlusion, changing lighting) | **NOT DONE** — only one person/partial framing |
| Physical capture/tracking/heat/reconnect metrics | **MEASURED for 30 s**, with one 60 s inference-start failure |
| Track ID stability on physical camera | **NOT STABLE ENOUGH TO CLAIM** — IDs 1 and 2 in 30 s |
| Physical speaker siren + speech | **VERIFIED ACOUSTICALLY** via internal mic (separate from loopback) |
| App volume / OS mute / app mute / browser restriction | **VERIFIED** (with internal-mic limitation) |
| Disconnected / wrong output device | **NOT TESTABLE** on this host |
| Queue / dedupe / ACK / repeat logic | **VERIFIED** on virtual camera E2E |
| Distress accuracy (precision/recall/F1/FP per hour) | **NOT VALIDATED** — no licensed session-labelled video |
| Live reliability on physical camera | **PARTIAL** — 30 s measured; longer run flaky |
| Live reliability on virtual camera | **MEASURED** |
| Rescue-operation readiness | **NOT CLAIMED** |

## 7. Reproduce

```powershell
# app
launch.bat

# physical camera (HP Webcam; 90 s scene run)
python tests/physical_camera_validation.py --seconds 90

# acoustic physical output (internal mic, not loopback)
python tests/acoustic_physical.py

# isolated OS mute check
python tests/os_mute_validation.py

# virtual-camera pipeline, queue, ACK, audio-failure and performance tests
python tests/e2e_audio_critical.py
python tests/e2e_sustained.py

# distress model workflow (refuses without licensed session-level data)
python ml/train_temporal.py
```

## 8. Conclusion

The software pipeline, heat map, incident lifecycle and alert controller are exercised and measurable. The physical speaker path is audibly verified through a separate microphone input. The physical HP Webcam path is **partially verified** on one person with partial framing; multi-person, lighting, occlusion and long-duration stability remain unverified. The green preview was correctly identified as the OBS virtual camera, not a Sea Sentry overlay. Distress screening remains an unvalidated experimental baseline. Sea Sentry is a human-supervised safety-support prototype, not a rescue-operations system.
