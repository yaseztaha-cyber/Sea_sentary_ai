# Validation report — swimmer-distress assessment

**Status: NOT VALIDATED on real swimmer-distress video.** No precision, recall,
F1, confusion matrix, false-alarms-per-hour or missed-event figure for real water
footage is reported, because no suitable licensed session-labelled corpus was
available. Nothing in this file invents those numbers.

## What was evaluated

### 1. Temporal logic — synthetic track vectors (unit tests, not epidemiological evidence)

`tests/distress.test.ts` drives the real `TemporalDistressAnalyzer` with generated
track histories. These tests check the decision logic and safety guardrails, not
real-world detection performance.

| Scenario | Expected | Observed |
| --- | --- | --- |
| Normal swimming across the frame | no suspected/critical | PASS |
| Floating / resting | no suspected/critical | PASS |
| Standing still in shallow water | WATCH at most, no emergency | PASS |
| Single dive/submersion gap | no suspected/critical | PASS |
| Repeated submersion + struggling + vertical posture + no progress, persisted | CRITICAL with stored indicators | PASS |
| Two submersion events + struggling, persisted | SUSPECTED, not CRITICAL | PASS |
| Same behavior outside the configured water zone | capped at WATCH | PASS |
| One assessment call with strong indicators | NORMAL (persistence required) | PASS |
| Structured output (ID, score kind, indicators, zone, visibility, limitations, `modelConfidence=null`) | present | PASS |

### 2. Live end-to-end pipeline with a virtual camera

`tests/e2e_audio_critical.py` (headed/headless Chromium, demo beach clip through
Chromium's fake webcam) verified real detection → track → heat map → WATCH →
critical incident → siren → spoken zone → acknowledgment. It does not validate
distress accuracy; the critical event was an operator-triggered TEST record.

### 3. System latency (real, independent of classifier quality)

- End-to-end critical alert (TEST observation POST → audible siren start):
  **0.34–3.46 s across runs** (final 150 s sustained run 3.46 s), depending on
  host load; includes UI call, DB persistence, dispatch and Web Audio start.
- Incident persistence alone: sub-second in the E2E.
- Detection → assessment → incident path: bounded by detector latency and the
  5 s repeat tick; critical evaluation runs on each detection.

## Dataset search and why validation is missing

Detailed sources and licences: `reports/DATASET_REVIEW.md` and `ml/README.md`.

- The only clearly licensed **underwater drowning image** set (Figshare, CC BY
  4.0, 5,613 images) does not expose authoritative session/video IDs in the
  release. Splitting frames randomly would leak frames from the same video into
  train and test, which this task forbids.
- A **84-video** infant swimming/drowning collection exists on Kaggle but its
  licence is listed as *Unknown*, so it was rejected.
- The Roboflow swimming/drowning export (CC BY 4.0) is image-level and lacks
  source session IDs.
- Other pool/open-water datasets are available only on request, are about
  man-overboard detection rather than distress, or have redistribution
  restrictions (ODIV).
- No dataset was found that combines (a) clear reuse licence, (b) normal +
  distress video, (c) session IDs, and (d) above-water camera conditions
  comparable to this console.

## Required before claiming validation

- Acquire or commission a licensed video corpus with complete sessions and
  distress onset/end annotations.
- Double-annotate and report inter-annotator agreement.
- Split by incident, subject and scene; lock a test set.
- Tune thresholds/persistence on validation only; report precision, recall, F1,
  confusion matrix, false alarms per hour, missed events and detection latency.
- Evaluate by condition: normal swimming, floating/resting, diving, treading,
  splashing/play, occlusion, glare, night, multiple swimmers, camera angle.
- Repeat live end-to-end tests with the trained temporal model and document
  remaining domain shift.

Until then, the product must call these events **suspected / possible swimmer
distress** and keep a human operator responsible. The UI does exactly that.
