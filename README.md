# SEA SENTRY AI — ABYSS

*An eye in the sky. A rescuer at sea.* — Project Creator & Developer: **Eyad Sherif Elbagoury** · V1 camera-based monitoring

## What this build is

A local-first, camera-based monitoring console built as **Next.js (App Router) +
PostgreSQL (Drizzle)**. It runs completely on the operator's machine: browser
camera, TensorFlow.js inference, tracking, temporal assessment, heat map,
incident persistence and local alert audio. No cloud inference, no face
recognition, no external responder integration.

| Stage | Implementation |
| --- | --- |
| Camera | `getUserMedia`; reports the actual negotiated resolution/frame-rate, measured capture FPS, stale-frame watchdog, reconnect |
| Stage A — detection | Real COCO-SSD `lite_mobilenet_v2` inference (TensorFlow.js, person class only); local weights in `public/models/coco-ssd-lite/` |
| Stage A — tracking | ByteTrack-style two-stage IoU tracker (+ centre-distance fallback), anonymous track IDs, confidence, lost/re-acquisition gaps, track history |
| Heat map | **Tracking-driven** occupancy / movement / dwell grids, per-camera state, Gaussian splats, configurable exponential decay, 1/5/15/30 min windows, optional monitored-area mask, overlay toggle, reset, live/historical/empty states |
| Stage B — distress | **Experimental** temporal assessment over track history: repeated submersion/re-acquisition, struggling-like reversals, vertical box posture, prolonged immobility, movement without progress, sudden change, persistence windows. Structured evidence and explicit limitations. Not a validated drowning detector. |
| Zones | Polygon drawing on the preview, normalized coordinates, 4 types, persisted in PostgreSQL; heat map and assessments use them |
| Incidents | PostgreSQL incident record, timeline, notes, statuses, duplicate/observation grouping, severity escalation (WATCH → SUSPECTED → CRITICAL), evidence snapshots, track history, bounded retention |
| Critical alert | Synthesized siren + local `speechSynthesis` announcement using the incident's actual zone; operator unlock, volume, siren/voice tests, dedupe by incident, queue/no overlap, repeat window, acknowledgment silences siren without resolving; visible failure state if audio cannot play |
| Real time | Server-Sent Events at `/api/events` (not WebSocket) |
| Performance | Live measured capture FPS, detector rate, tracking rate, latency avg/p95, preprocess, frame age, server CPU/RSS, system RAM, browser heap, selected provider, end-to-end alert latency, benchmark table |

## Live pipeline

```
Camera → latest-frame capture → person detector → tracker → track history
      → activity heat map → temporal distress assessment → incident engine
      → SSE → critical siren + spoken zone → operator acknowledgment
```

The tighter path is `src/lib/engine/runtime.ts`; `pipeline.ts` wires detection,
tracking, heat map and distress. Heat-map anchors, trail points, track IDs,
assessments and incident evidence all use the same normalized person-centre
coordinate.

## Run

```powershell
# Windows 11, Node.js 20+, PostgreSQL
# One-click launch (checks Node/PostgreSQL, installs/builds if needed, starts
# the production server and opens the console):
launch.bat

# Manual:
npm ci
npm run build
npm run db:migrate
npm start
```

Open `http://localhost:3000/app` and sign in with the operator password from
your local `.env` (`OPERATOR_PASSWORD`). The public landing page remains open;
the console and its APIs are protected by a signed HTTP-only session cookie.
For production, set `OPERATOR_PASSWORD` (or `OPERATOR_PASSWORD_HASH`),
`SESSION_SECRET`, `DATABASE_URL` and `PUBLIC_BASE_URL`. See
`DEPLOYMENT.md` and `.env.example`.

1. **Connect camera** (real webcam or a virtual camera in tests).
2. **Run AI** (loads and benchmarks TF.js backends, then starts inference).
3. **Enable alert audio** once per monitoring session (browser autoplay policy).
4. Use **Test siren**, **Test voice**, and **TEST × 4 critical** to verify the
   alert path. TEST records are clearly labelled and never presented as real
   detections.

Settings are persisted in PostgreSQL and apply live.

## Verification (actually executed)

| Area | Result |
| --- | --- |
| Unit tests: heatmap, tracker, temporal distress, pipeline | **23/23 PASS** (`npm test`) |
| Live virtual-camera E2E: real detection → track → heat samples → mode switch → WATCH no audio → critical incident → siren + spoken zone → ACK keeps incident open → dedupe → audio-failure visibility | **PASS** (`python tests/e2e_audio_critical.py`) |
| Physical speaker path | **PASS** — WASAPI loopback captured the siren and speech (peak RMS 0.46; `reports/evidence/audio-loopback.wav`) (`python tests/audio_loopback.py`) |
| Incident API: SUSPECTED → CRITICAL escalation, acknowledgment, manual resolution | **PASS** (`python tests/api_incidents.py`) |
| Sustained performance (150 s, headed Chromium, 640×360 @10 fps virtual camera) | Capture p50 9.7 fps, detector p50 ≈5.8/s, latency p50 90 ms / p95 145 ms, 1 track, browser process CPU p50 ≈19 % of 8 logical cores, server RSS ≈87 MB, end-to-end critical alert 0.34–3.46 s across runs |
| Input-size / provider benchmark | WebGL selected after verified probes; 320/416/512/640 interleaved runs; 640 selected (best p50 + highest mean detection score in the clean run) |
| ONNX Runtime providers | CPU and DirectML both verified on this machine (MobileNetV2-7: CPU 13.6 ms vs DirectML 16.8 ms p50); not integrated into the live TF.js path |
| Real swimmer-distress validation | **NOT VALIDATED** — no suitable licensed session-labelled video corpus was available. See `reports/VALIDATION_REPORT.md` and `ml/README.md`. |

Production deployment, operator access protection, database migrations and the
conditional alert channels are documented in `DEPLOYMENT.md`. The release
status and any external blockers are recorded in
`reports/PRODUCTION_RELEASE_REPORT.md`.

Exact numbers, caveats and raw files: `reports/TEST_REPORT.md`,
`reports/PERFORMANCE_REPORT.md`, `reports/VALIDATION_REPORT.md`,
`reports/DATASET_REVIEW.md`, and the physical-hardware audit
`reports/PHASE2_ACCEPTANCE_REPORT.md`.

**Camera source note:** Chromium may select **OBS Virtual Camera** as the system
default; it can emit a green placeholder. Select the real webcam in
**Settings → Camera source** (for example “HP Webcam”). A virtual source is
labelled on the preview and is not physical-camera evidence.

## Honest status

**Working:** camera acquisition and actual-frame processing; person detection;
anonymous tracking; per-camera heat maps in three modes with decay and zone
masking; temporal behavior indicators and structured assessments; incident
persistence/grouping/escalation; SSE; critical siren + local spoken zone;
operator unlock, tests, dedupe, queue, repeat window, acknowledgment and audio
failure state; evidence snapshots; responsive ABYSS monitoring UI; benchmark
table; real measured performance.

**Experimental / not validated:** the distress thresholds and temporal indicator
weights. They are engineering defaults, not clinically or operationally
validated. `modelConfidence` is `null` because no trained temporal artifact
exists. Do not claim guaranteed or confirmed drowning detection. Floating,
resting, diving, splashing and single still periods are explicitly not treated
as emergencies by the baseline, but false positives/negatives remain possible.

**Hardware limits:** the HP Webcam was verified on a limited one-person,
partial-framing pass at 640×480 (30 fps reported, ~7.6 measured capture fps,
~5.9 detections/s); multi-person, lighting, deliberate occlusion and long-run
physical stability remain unverified. A 60 s repeat failed to start inference
despite “ready” state, so physical reliability is **partial**, not production
proof (see `reports/PHASE2_ACCEPTANCE_REPORT.md`). WebSocket transport; MJPEG
preview routes intentionally return HTTP 501; browser pixel format is not
exposed; no SMS/e-mail/responder integration. ONNX Runtime is not in the live inference path
(the live detector is TF.js); DirectML was verified separately, not assumed.

## Layout

```
src/app/page.tsx              landing page
src/components/landing/       ABYSS sections
src/components/app/           console UI (heatmap, distress, audio, critical banner, inspector, zones)
src/lib/engine/               detector · tracker · heatmap · distress · pipeline · runtime · draw
src/lib/audio/alerts.ts       siren + local speech controller
src/app/api/                  incidents, zones, settings, events (SSE), auth, push, telegram, phone, system
src/db/schema.ts              PostgreSQL schema (Drizzle)
ml/                           temporal feature extraction + grouped train/eval workflow
tests/                        Vitest unit tests + Playwright/Python E2E and audio/performance tests
reports/                      executed test, performance, validation and dataset reports
public/models/                local detector weights
```

## Credits & licences

Footage and photographs: Pexels contributors (Pexels licence). Clash Display:
Fontshare (free commercial licence, see `public/fonts/ClashDisplay-License`).
Instrument Serif, Manrope, IBM Plex Mono: SIL OFL 1.1. COCO-SSD model code and
published weights: Apache-2.0; MS-COCO annotations CC BY 4.0. ONNX benchmark
model: MobileNetV2-7 from the ONNX model zoo, Apache-2.0. Dataset review and
limitations: `reports/DATASET_REVIEW.md`.
