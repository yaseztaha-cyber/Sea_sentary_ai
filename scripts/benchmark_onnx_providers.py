"""Benchmark installed ONNX Runtime execution providers on this actual machine.

This does not benchmark the browser person detector; it answers a separate
question: which ONNX Runtime providers are genuinely installed and usable here,
and what latency does a real CNN achieve on CPU vs DirectML.

Usage:
  python scripts/benchmark_onnx_providers.py --model test-artifacts/mobilenetv2-7.onnx

The model used for the recorded run is MobileNetV2-7 from the ONNX model zoo
(Apache-2.0). No CUDA packages are installed or required.
"""
from __future__ import annotations

import argparse
import json
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort


def bench(provider: str, model: str, runs: int) -> dict:
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = 4
    started = time.perf_counter()
    sess = ort.InferenceSession(model, sess_options=opts, providers=[provider])
    load_ms = (time.perf_counter() - started) * 1000
    inp = sess.get_inputs()[0]
    shape = [int(x) if isinstance(x, int) else 1 for x in inp.shape]
    rng = np.random.default_rng(7)
    x = rng.standard_normal(shape, dtype=np.float32)
    for _ in range(3):
        sess.run(None, {inp.name: x})
    times = []
    out = None
    for _ in range(runs):
        t0 = time.perf_counter()
        out = sess.run(None, {inp.name: x})
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    return {
        "requested_provider": provider,
        "session_providers": sess.get_providers(),
        "input": {"name": inp.name, "shape": shape, "type": inp.type},
        "load_ms": round(load_ms, 1),
        "runs": runs,
        "p50_ms": round(times[len(times) // 2], 2),
        "p95_ms": round(times[min(len(times) - 1, int(len(times) * 0.95))], 2),
        "mean_ms": round(statistics.mean(times), 2),
        "output_shape": list(out[0].shape) if out is not None else None,
        "output_checksum": round(float(np.sum(out[0])), 4) if out is not None else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="test-artifacts/mobilenetv2-7.onnx")
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--out", default="test-artifacts/onnx-provider-benchmark.json")
    args = ap.parse_args()
    model = Path(args.model)
    if not model.exists():
        print(f"model not found: {model}", file=sys.stderr)
        return 2
    report: dict = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "onnxruntime": ort.__version__,
        "available_providers": ort.get_available_providers(),
        "device": ort.get_device(),
        "model": {"path": str(model), "bytes": model.stat().st_size, "license": "Apache-2.0 (ONNX model zoo MobileNetV2-7)"},
        "sessions": [],
    }
    for provider in ort.get_available_providers():
        if provider not in ("CPUExecutionProvider", "DmlExecutionProvider"):
            continue
        try:
            report["sessions"].append(bench(provider, str(model), args.runs))
        except Exception as e:  # provider may be advertised but unusable
            report["sessions"].append({"requested_provider": provider, "error": str(e)})
    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
