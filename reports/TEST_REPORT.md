# Test report — Sea Sentry AI upgrade

Environment: Windows 11 Pro 10.0.26100, Intel i7-6820HQ, 16 GB RAM, no CUDA.
Production build served with `next start` on `http://127.0.0.1:3000`. Camera
input for automation was Chromium's fake webcam fed from the bundled 20 s demo
clip (the only camera available in this environment). The live code path is
identical to a physical webcam (`getUserMedia` → `requestVideoFrameCallback`).

Generate the virtual-camera input before running the E2E scripts:

```powershell
python scripts/make_y4m.py --width 640 --height 360 --fps 10 `
  --max-frames 3000 --loop --out test-artifacts/camera-5min-640.y4m
```

## Build and static checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | PASS |
| ESLint | `npx eslint src tests --max-warnings=0` | PASS |
| Production build | `npm run build` | PASS (Next.js 16.4.2) |
| Unit tests | `npm test` | **23/23 PASS** |

## Automated test inventory

| File | What it proves |
| --- | --- |
| `tests/heatmap.test.ts` | 8 tests: one moving person, multiple people, dwell, no-people empty state, decay, no gap injection, zone mask + IGNORE subtraction, per-camera separation, normalized resolution invariance |
| `tests/tracker.test.ts` | stable anonymous ID, short interruption re-association + real gap recorded, two people separate, heat only receives tracked samples, camera maps stay separate, structured assessment from real track history |
| `tests/distress.test.ts` | normal swimming, floating/resting, standing still (WATCH max), single dive, persistence required, CRITICAL requires multiple indicators, SUSPECTED scenario, outside-water cap, structured output with `modelConfidence=null` |
| `tests/e2e_audio_critical.py` | live pipeline + UI: heat samples, mode switch, audio unlock, siren signal, spoken zone, WATCH no audio, critical incident, dedupe, ACK stops siren and keeps incident open, audio-disabled failure is visible |
| `tests/api_incidents.py` | SUSPECTED→CRITICAL escalation, observation grouping, event timeline, ACK not resolving, manual resolution |
| `tests/audio_loopback.py` | physical speaker path: WASAPI loopback capture while browser plays a critical alert |
| `tests/e2e_sustained.py` | 150 s sustained capture/inference/tracking/heat performance and alert latency |

## Unit test result

```
Test Files  3 passed (3)
Tests       23 passed (23)
```

## Live end-to-end result

Command: `python tests/e2e_audio_critical.py` (fresh production build). Results:

| Step | Observed |
| --- | --- |
| Real detection → anonymous track | track #1, 1 person |
| Tracking-driven heat map | 25 samples, 160 active cells in the tested window; occupancy mode |
| Mode switch | Occupancy → Movement via UI, persisted |
| Audio unlock | `AudioContext` running; 3 local voices; Microsoft David selected |
| Siren test | played; measurable Web Audio signal peak **0.278** |
| Voice test | local speechSynthesis; spoken text includes Zone North Beach |
| WATCH observation | no audio playback, no active alert |
| Critical incident | INC-0037, severity CRITICAL, zone North Beach; siren + spoken warning |
| Duplicate announcement | refused: “Already announced for this incident” |
| Acknowledgment | active audio null, state back to `ready`, incident status ACKNOWLEDGED; still present in open-incident API |
| Multi-incident audio queue | one active announcement + 1 queued; no overlap |
| Disabled audio critical | visible “AUDIBLE ALERT FAILED / NOT PLAYED” banner + notice; no claim of playback |

Raw results: `reports/e2e_results.json`; screenshot:
`reports/evidence/critical-banner.png`.

## Physical audio verification

Command: `python tests/audio_loopback.py` (headed Chromium; default Realtek
speaker; soundcard WASAPI loopback). A TEST critical alert was played and the
system mix was recorded for 16 s.

- Peak amplitude **0.9631**, peak 100 ms RMS **0.3543**.
- 95 active 100 ms windows.
- Distinct segments include 0.0–2.6 s (siren) and later speech segments through
  12.8 s.
- Verdict: **audible output captured** (`reports/evidence/audio-loopback.json`,
  `reports/evidence/audio-loopback.wav`).

This is the strongest available check that the siren and voice leave the browser
and reach the speaker. It does not guarantee a human was present or that the OS
volume was comfortable.

## Incident API result

```
incident 23 · SUSPECTED→CRITICAL · ACK kept open · final RESOLVED
```

The escalation event, grouped observations and manual resolution were verified
directly against PostgreSQL-backed API.

## Heat map verification detail

Unit and live tests cover:

- One tracked person moving across the camera (path cells populated).
- Multiple simultaneous people (both regions populated).
- One person remaining in an area (dwell accumulates; movement low).
- No people: no new samples and old activity decays.
- Temporary tracking interruption: no samples are added while the track is
  lost; trail drawing breaks at gaps.
- Camera switch: per-camera map preserved/isolated.
- Resolution changes: normalized coordinates, no drift.
- Zone mask: activity outside monitored area hidden; IGNORE subtracts.
- Empty state and live/historical labels in the UI.
- Camera overlay toggle and 1/5/15/30 min windows.

Not measured: a physical thermal sensor (there is none — this is activity
density, explicitly labelled as such), and long multi-hour decay on a physical
camera.

## Distress engine verification detail

The engine is tested against synthetic track histories (documented in
`reports/VALIDATION_REPORT.md`) and exercised live on real detector tracks. It
correctly does not escalate normal swimming, floating, a single dive, or a single
still period. It only reaches CRITICAL after multiple weighted indicators persist
across repeated assessments. The live critical alert in E2E is an operator TEST
record; **no real drowning was staged or claimed**.

`modelConfidence` is always `null`; the score is marked
`unvalidated-heuristic`. The UI shows this in the inspector, assessment panel and
incident evidence.

## Known test gaps

- No physical webcam was available; virtual camera only.
- No real swimmer-distress video dataset, so classifier precision/recall/F1,
  false alarms/hour and missed events on water footage are **not computed**.
- Multi-person sustained performance above one tracked person was not measured.
- Repeated critical-alert timer for real (non-TEST) incidents is implemented but
  not exercised end-to-end; the controller’s dedupe, queue and max-repeat logic
  were code-reviewed and the per-incident duplicate path was tested.
- Browser process CPU is measured externally (Playwright/psutil), not displayed
  in the console; the console displays server CPU/RAM and browser heap.
- The physical audio loopback verifies signal output, not speech intelligibility
  in a noisy environment.
