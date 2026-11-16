# Dataset review

Checked 2026-11-14 for a legally usable, session-labelled video corpus containing
normal swimming and swimmer-distress behavior.

| Dataset | Content | Licence / access | Usability decision |
| --- | --- | --- | --- |
| Underwater Drowning Detection Dataset — Alzaabi et al. (Figshare 29497235) | 5,613 annotated underwater images; 3 states (swimming, struggling, drowning); paper describes 69,512 frames | **CC BY 4.0**; public 1.49 GB download | Rejected for temporal validation: the release is frame images without authoritative session/video IDs or a frame-to-source map. Any random split risks frame leakage; a session-disjoint split cannot be guaranteed. Underwater domain also differs from the above-water console camera. Suitable for a future *auxiliary* underwater frame classifier with careful provenance, not for this live validation. |
| Dataset of infants swimming — Kaggle `meizhiqiang/dataset-of-infants-swimming` | 84 videos (49 normal, 35 drowning), 7,000 images | Kaggle page: **Unknown** licence; paper describes a request/ethics process | Rejected: no clear reuse licence. |
| Swimming and Drowning DataSet — Kaggle `alanoudawaji/swimming-and-drowning-dataset` | ~388 MB Roboflow export, 20k image/label files | Roboflow README states **CC BY 4.0** | Not used for temporal validation: image-level export with no original session IDs; cannot split by video/session. |
| IET "Pool" dataset — Liu et al. 2023 | 27 train + 13 test clips; normal swimming/treading + abnormal drowning; underwater | Available from corresponding author on request | Not public; not verified. |
| ODIV open-water incident dataset (2026 paper) | 101 positive + 102 negative clips, clip-level labels, described split by subject/scene | Paper CC BY 4.0; source clips from social media with redistribution restrictions | No public download; platform terms/ethics uncertain. Not used. |
| SDVDs — sonar drowned-victim dataset (Zenodo) | Sonar images/masks of drowned victims | ODbL | Different sensor modality; not swimmer-distress video. Not used. |
| MOBDrone — Zenodo 5996890 | Drone man-overboard detection | **CC BY 4.0** | Task mismatch (man overboard, not temporal distress behavior); not used as distress validation. |

## Conclusion

No dataset found meets all of:

1. explicit reusable licence;
2. normal **and** distress **video** sequences;
3. authoritative video/session boundaries for a leak-free split;
4. scene conditions comparable to the live camera.

Therefore the live temporal assessment is an **experimental heuristic baseline**
and the trained sequence workflow (`ml/train_temporal.py`) is provided but was
not run. No metrics are fabricated. `reports/VALIDATION_REPORT.md` states the
missing evaluation explicitly.

## Re-download / verification notes

- Figshare API metadata: `https://api.figshare.com/v2/articles/29497235` (file
  `datasets.zip`, 1.49 GB, CC BY 4.0). No frame-session manifest was listed.
- Kaggle dataset listing/download API was reachable; licences were read from the
  dataset pages/READMEs. The unknown-licence dataset was not downloaded or used.
- ONNX benchmark model (not a dataset): MobileNetV2-7 from the ONNX model zoo,
  Apache-2.0, used only for provider latency measurement.
