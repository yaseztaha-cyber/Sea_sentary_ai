# Temporal swimmer-distress model workflow

This directory contains the training/evaluation path for Stage B. The live
console does **not** ship a trained temporal model: no suitable, legally usable,
session-labeled video corpus was available in this build. The live behavior is a
clearly labeled **experimental heuristic baseline** (`scoreKind:
"unvalidated-heuristic"`, `modelConfidence: null`).

## Dataset review (checked 2026-11-14)

| Source | What is available | License | Why it is not used for validation here |
|---|---|---|---|
| [Underwater Drowning Detection Dataset](https://doi.org/10.6084/m9.figshare.29497235) | 5,613 annotated underwater images, 3 classes (swimming / struggling / drowning); paper describes 69,512 frames from pool videos | CC BY 4.0 | Released as frame images without session/video identifiers or an authoritative frame-to-video map. A session-disjoint split cannot be guaranteed, so it cannot support this task's required video/session split. Underwater domain also differs from the above-water console camera. |
| [Infant swimming/drowning dataset](https://www.kaggle.com/datasets/meizhiqiang/dataset-of-infants-swimming) | 84 videos (49 normal, 35 drowning), 7,000 extracted images | Kaggle page says **Unknown** | Cannot reuse or redistribute safely; validation on it would not be a legally documented evaluation. |
| [Swimming and Drowning DataSet](https://www.kaggle.com/datasets/alanoudawaji/swimming-and-drowning-dataset) | ~388 MB Roboflow export, image folders | Roboflow README says CC BY 4.0 | Image-level export without original session identity; no temporal windows or video-level split possible. |
| IET "Pool" dataset (Liu et al., 2023) | 27 train + 13 test clips, underwater | Available from authors on request | Not publicly downloadable; cannot be verified here. |
| ODIV open-water clip dataset (2026 paper) | 101 positive / 102 negative clips described | Paper CC BY 4.0; clips sourced from social media with redistribution restrictions | No public download; platform terms and ethics make redistribution unclear. |
| [MOBDrone](https://doi.org/10.5281/zenodo.5996890) | Drone man-overboard detection | CC BY 4.0 | Detects people overboard, not temporal swimmer distress. Not suitable as a distress label set. |

Conclusion: **do not claim the distress classifier is validated.** The current
thresholds are engineering defaults, not thresholds selected on representative
water footage. The live output explicitly says so.

## Input schema

```json
{
  "sessions": [
    {
      "id": "pool_session_001",
      "source": "pool-cam-a",
      "label": "normal|distress",
      "split": "train|val|test",
      "event_start": 12.0,
      "event_end": 27.0,
      "license": "CC BY 4.0",
      "url": "https://example.org/dataset",
      "frames": [
        {
          "t": 0.0,
          "tracks": [
            {"id": 1, "x": 0.42, "y": 0.55, "w": 0.05, "h": 0.12, "score": 0.91, "visible": true, "gap_seconds": null}
          ]
        }
      ]
    }
  ]
}
```

- `x,y` = normalized person-centre anchor. This matches the live tracker's heat
  map and assessment anchor.
- `gap_seconds` on the first frame after a re-acquisition records the missing
  interval.
- If `event_start`/`event_end` are present, only windows overlapping that event
  are positive. Otherwise the session label applies.
- `split` is optional. If absent, sessions are assigned deterministically by a
  hash of the session ID (70/15/15); frames are never split individually.
- Every session must document `source` and `license`.

## Train and evaluate

```powershell
python ml/train_temporal.py --data data/sequences.json `
  --out public/models/distress/sequence-model.json `
  --report reports/temporal_model_report.json
```

The script refuses to run without `data/sequences.json`. It:

1. validates unique session IDs and provenance;
2. extracts 18 temporal features per 20 s window with 2 s stride;
3. standardizes on the training split;
4. trains class-balanced L2 logistic regression (a compact sequence classifier);
5. selects the threshold on the validation split only;
6. evaluates once on the test split and reports precision, recall, F1,
   confusion matrix, false alarms/hour and the exact split session IDs.

The resulting JSON artifact records feature order, scaler, weights, threshold,
provenance and metrics. It is intentionally not loaded by the live console in
this build because no artifact has been produced. Adding a validated artifact
must also include an integration change and a new validation report.

## Required improvements before any product claim

- Obtain a licensed corpus with **complete session identities** and both normal
  and distress sequences covering pool/lake/coast, glare, occlusion, night,
  multiple swimmers and camera angles.
- Double-annotate distress onset/end; report inter-annotator agreement.
- Split by incident, subject and scene, not by frame.
- Tune thresholds and persistence on validation only; lock the test set.
- Report precision/recall/F1, false alarms/hour, missed events and alert latency
  on held-out sessions.
- Re-run the live end-to-end tests with the trained artifact and document the
  remaining domain shift.
