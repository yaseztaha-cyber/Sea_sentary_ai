# Person detector — model card

| Item | Value |
| --- | --- |
| Artifact | COCO-SSD `lite_mobilenet_v2` (TensorFlow.js graph model) |
| Architecture | SSDLite + MobileNetV2 |
| Package | `@tensorflow-models/coco-ssd` 2.2.x (loader); weights in `public/models/coco-ssd-lite/` |
| Weights source | `https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/` (TensorFlow Object Detection API model zoo, converted to TF.js) |
| Licence | Code: Apache-2.0. Published model-zoo weights: Apache-2.0. Training data: MS-COCO (annotations CC BY 4.0, images under Flickr terms). |
| Commercial use | Apache-2.0 permits it, but re-verify the upstream weight licence before commercial deployment. |
| Classes | 90 COCO classes; only `person` (id 1) is used |
| Input | RGB frame; longest side configurable 320 / 416 / 512 / 640 px. **Default 640 px**, selected by the interleaved on-machine benchmark. |
| Output | boxes, class, score per detection; Sea Sentry adds frame id, timestamp, preprocess/inference latency |
| Runtime | TensorFlow.js in the browser. At load, WebGL and CPU are probed; **WebGL is used when verified**, CPU is fallback. The console reports the actual backend. |
| Licence-cleared ONNX options | Not integrated in the live path. ONNX Runtime CPU and DirectML were benchmarked separately (see `reports/PERFORMANCE_REPORT.md`). |

## Provider and input benchmarks (actual machine)

- Live provider probes: WebGL and CPU both complete a 192×192 conv workload; WebGL is selected for CNN inference when verified. CPU live inference was measured at ~11.4 s/frame in headed Chromium versus ~0.08 s p50 for WebGL at 640 px after warm-up; CPU is therefore fallback only, not the default.
- Interleaved input-size run (10 measured passes each, frozen 640×360 frame): 320 px 91.9 ms p50 / 187.1 ms p95 / mean score 0.89; 416 px 86.7 / 112.2 / 0.91; 512 px 85.8 / 141.8 / 0.92; 640 px **78.7 / 170.0 / 0.93**. All four had one person and 100% IoU-0.5 agreement against the 640 px reference. 640 px selected.
- These are latency/consistency measurements, not accuracy. No ground-truth water labels were used; agreement with the 640 px reference is not mAP.

## Stage B — temporal distress assessment

Stage B is a separate, explainable baseline over real tracker output. It uses
track history and gap events, not a single image and not a drowning-trained
classifier. It emits `level`, `score` (`scoreKind: "unvalidated-heuristic"`),
`modelConfidence: null`, observable indicators, persistence duration, zone,
visibility and limitations. Critical classification requires persistence and
multiple indicators, and a track outside configured water zones is capped at
WATCH.

**It is not validated on labelled swimmer-distress video.** No suitable,
legally usable, session-labelled video corpus was available. See
`reports/VALIDATION_REPORT.md`, `reports/DATASET_REVIEW.md` and `ml/README.md`.

## Known limitations

* Not trained or validated on swimmers, surf, or water-surface footage. Heads in
  water, partial bodies, reflections, glare and distance degrade detection.
* Distant people can be missed even at 640 px; a missed detection becomes a
  tracker gap, which is one of the distress indicators but is also ambiguous.
* Bounding-box aspect ratio is a coarse posture proxy; it is not a pose model.
* Head/waterline relation is unavailable and explicitly reported as such.
* Track IDs are anonymous and local to a camera session. A long submersion may
  cause a new ID; repeated-submersion evidence can be missed across ID switches.
* CPU inference is not viable for real-time use on this laptop; WebGL is the
  verified provider.
* No facial recognition or identity recognition is implemented.
* No claim of guaranteed or confirmed drowning detection is made.
