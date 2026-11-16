# Performance report — actual laptop

**Machine:** Intel Core i7-6820HQ (4 cores / 8 threads), 16 GB RAM, AMD Radeon
R7 M370, Windows 11 Pro 10.0.26100. No NVIDIA/CUDA hardware or packages.
Chromium's WebGL renderer in the headed test reported:
`ANGLE (Intel, Intel(R) HD Graphics 530, Direct3D11 vs_5_0 ps_5_0, D3D11)`.
The Radeon GPU was not claimed as active; the live provider is measured, not
assumed.

## 1. Inference-provider verification

### TensorFlow.js live detector (the actual live path)

At model load the app runs a real 192×192×16 convolution stack on every
available TF.js backend and records the measured time:

- **WebGL:** verified (`probes.ok = true`).
- **CPU:** verified.
- **Selected:** **WebGL**. A verified WebGL path is preferred for CNN inference.
  The live detector was measured at ~11.4 s/frame on TF.js CPU in headed
  Chromium, versus ~0.08 s p50 on WebGL after warm-up. CPU remains a fallback,
  not the default.
- The UI reports the actual backend (`TF.js · webgl`) and the probe reason.
- No CUDA/NVIDIA dependency was installed.

### ONNX Runtime (separate benchmark, not integrated in live inference)

Installed in an isolated Python 3.14 venv to avoid destabilising the app. Model:
MobileNetV2-7 from the ONNX model zoo, Apache-2.0, 14,246,826 bytes; input
1×3×224×224.

| Provider | Session providers | Load | p50 | p95 | Output checksum |
| --- | --- | ---: | ---: | ---: | ---: |
| CPUExecutionProvider | CPU | 397.6 ms | **13.58 ms** | 18.74 ms | 3.2942 |
| DmlExecutionProvider | DML + CPU | 11,336.6 ms | 16.76 ms | 17.17 ms | 3.2943 |

DirectML genuinely executes on this machine, but for this CNN it is slower than
CPU and its first session load is very slow. It was not adopted. DirectML is not
available to TensorFlow.js; the live detector remains TF.js WebGL. No CUDA was
installed. Raw data: `test-artifacts/onnx-provider-benchmark.json`.

## 2. Input-size benchmark (live detector, real frozen camera frame)

Method: one frozen 640×360 live frame; each size warmed once; then **10
interleaved measured passes**, so a later resolution cannot benefit from a warmed
GPU. "Agreement" = fraction of 640 px reference detections matched at IoU ≥ 0.5
(a consistency measure, **not accuracy**).

| Input | p50 | p95 | Persons | Mean score | Agreement vs 640 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 320 px | 91.9 ms | 187.1 ms | 1 | 0.89 | 100% |
| 416 px | 86.7 ms | 112.2 ms | 1 | 0.91 | 100% |
| 512 px | 85.8 ms | 141.8 ms | 1 | 0.92 | 100% |
| **640 px** | **78.7 ms** | 170.0 ms | 1 | **0.93** | 100% |

An earlier run under heavier system load produced 464–771 ms p50 values; it is
retained in `test-artifacts/benchmark-result-headed.json` to show variance. The
clean interleaved run is used for configuration.

**Selected configuration:** input **640 px**, WebGL, min score 0.5, max 20
detections, target 6 inference attempts/s. Rationale: best p50 and highest mean
detection score in the clean run, with full agreement to the reference; quality
was prioritised over a marginal FPS gain. The benchmark does not prove water
accuracy.

## 3. Sustained run — 150 s, headed Chromium

Source: 640×360 virtual camera @10 fps (demo beach clip), input 640, WebGL,
65 snapshots over 150 s. Raw samples: `reports/performance_run.json`. Browser
CPU/RSS are summed over the CDP process list for this Playwright browser only
(via `SystemInfo.getProcessInfo` + psutil), not all Chrome windows on the
machine. Earlier runs under different host load are preserved as
`reports/performance_run_loaded.json`; they show the same detector rate but
worse UI sampling and alert latency.

| Measurement | Result |
| --- | --- |
| Capture FPS | p50 **9.67**, p10 5.88, min 1.06 |
| Detector rate | p50 **5.78 /s**, mean 5.44 /s, p10 4.35 /s |
| Tracking update rate | p50 5.78 /s |
| Inference latency | p50 **89.9 ms**, p95 **145.4 ms**, max 147.1 ms |
| Snapshot p95 latency | p50 150.3 ms, max 862.4 ms |
| Frame age at inference | p50 46.8 ms, p95 95.9 ms |
| Tracks | p50 1, max 1 |
| Heat samples accumulated | 762 over the run |
| Server process CPU | p50 0.1%, max 0.3% (server does not run inference) |
| Browser process CPU | p50 **18.6%**, p95 21.3% of 8 logical cores; max 27.1% |
| Browser process RSS | p50 **1,019 MB**, max 1,254 MB |
| Browser JS heap | p50 167.7 MB, max 200.6 MB |
| Server RSS | p50 87 MB, max 89 MB |
| End-to-end critical alert (TEST) | **3.46 s** in this run (0.34–3.46 s across runs; includes page call, DB persistence, SSE/local dispatch and audio start) |
| Alerts / errors | 1 test alert; 0 capture failures |

Interpretation:

- The capture loop stayed at the camera's 10 fps; inference ran at ~5.9/s. The
  latest-frame policy prevented a backlog (frame age p50 49 ms).
- WebGL readback is the main cost. Keeping inference off the UI thread would
  require a separate worker/offscreen path; it was not added because the
  measured stable path already sustains 5.9 detections/s on this hardware.
- Browser CPU is measured externally via Playwright/psutil (sum of Chromium
  process CPU deltas / elapsed / logical cores). The console reports **server**
  CPU/RAM and browser JS heap; it does not pretend to measure total browser CPU.
- Alert latency includes DB persistence, SSE/local dispatch and Web Audio start;
  it is not a target value.

## 4. Original vs optimized

| Aspect | Before upgrade | After upgrade |
| --- | --- | --- |
| Backend selection | WebGL assumed if available | Real workload probe; WebGL preferred when verified, CPU fallback; CPU live path measured at ~11.4 s/frame and avoided |
| Input size | 512 (old default) | 640 selected by interleaved benchmark |
| Frame policy | latest frame, measured ~0.7–1.0 FPS in software-rendered headless baseline | latest frame; 5.9/s detected on headed hardware; 80 ms p50 |
| Heat layer | recomputed/drawn on every animation frame when overlay on | heat layer cached at ~4 Hz offscreen, composited each frame |
| Tracking/heat/distress | sequential in one loop | same single pipeline, but heat cache and bounded history prevent unbounded work |
| Quantization | none | **not applied**: no validated INT8 artifact for the TF.js graph; blind quantization was rejected because accuracy impact was not measured |

Headless software WebGL (used in early baseline) is not comparable to headed
hardware WebGL; both are reported separately.

## 5. Remaining constraints

- Physical USB webcam unavailable in the test environment; Chromium virtual
  camera was used. Camera negotiation path is exercised, but a specific physical
  device is not certified here.
- The demo scene contains one/two people. Multi-person sustained load was not
  measured above one tracked person.
- Distance/small-swimmer detection quality is not validated; 640 px was chosen
  to preserve detail but no water ground truth exists.
- No INT8 quantization, TensorRT, CUDA or WebGPU path is used.
