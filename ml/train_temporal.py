"""Train and evaluate the temporal swimmer-distress sequence model.

This is the real training workflow for licensed, session-labeled video-derived
tracks. It deliberately refuses to run without data: there is no synthetic
training set and no fabricated metrics.

Expected input and feature schema: see ml/README.md and ml/features.py.

Example:
  python ml/train_temporal.py --data data/sequences.json \
      --out public/models/distress/sequence-model.json \
      --report reports/temporal_model_report.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_NAMES, extract  # noqa: E402


def grouped_split(sessions: list[dict], seed: int = 17) -> dict[str, str]:
    ids = [str(s["id"]) for s in sessions]
    if len(set(ids)) != len(ids):
        raise ValueError("session ids must be unique; frames may not be split independently")
    explicit = {str(s["id"]): s.get("split") for s in sessions}
    if all(v in ("train", "val", "test") for v in explicit.values()):
        return {k: str(v) for k, v in explicit.items()}
    assigned: dict[str, str] = {}
    for sid in ids:
        h = int(hashlib.sha1(f"{seed}:{sid}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        assigned[sid] = "train" if h < 0.7 else "val" if h < 0.85 else "test"
    return assigned


def metrics(y: np.ndarray, p: np.ndarray, threshold: float, negative_hours: float) -> dict:
    pred = (p >= threshold).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "n": int(len(y)),
        "threshold": threshold,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_alarms_per_hour": round(fp / negative_hours, 3) if negative_hours > 0 else None,
        "negative_hours": round(negative_hours, 3),
        "confusion_matrix": [[tn, fp], [fn, tp]],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/sequences.json")
    ap.add_argument("--out", default="public/models/distress/sequence-model.json")
    ap.add_argument("--report", default="reports/temporal_model_report.json")
    ap.add_argument("--window", type=float, default=20.0)
    ap.add_argument("--stride", type=float, default=2.0)
    ap.add_argument("--epochs", type=int, default=400)
    ap.add_argument("--lr", type=float, default=0.15)
    ap.add_argument("--l2", type=float, default=0.002)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()
    data_path = Path(args.data)
    if not data_path.exists():
        print(
            "DATASET NOT PRESENT. No model was trained and no metrics were produced.\n"
            "Supply a licensed, session-labeled sequence file at "
            f"{data_path} (schema in ml/README.md) after reviewing reports/DATASET_REVIEW.md.",
            file=sys.stderr,
        )
        return 2
    doc = json.loads(data_path.read_text(encoding="utf-8"))
    sessions = doc.get("sessions", [])
    if len(sessions) < 6:
        print("Not enough sessions for grouped train/val/test. At least 6 sessions are required.", file=sys.stderr)
        return 2
    for s in sessions:
        if s.get("label") not in ("normal", "distress"):
            raise ValueError(f"session {s.get('id')} needs label normal|distress")
        if not s.get("license") or not s.get("source"):
            raise ValueError(f"session {s.get('id')} is missing documented source/license")
    splits = grouped_split(sessions, args.seed)
    for s in sessions:
        s["split"] = splits[str(s["id"])]
    rows = extract(doc)
    if not rows:
        print("No feature windows extracted; check the sequence schema.", file=sys.stderr)
        return 2
    by_split = {k: [r for r in rows if splits[r.session_id] == k] for k in ("train", "val", "test")}
    if not by_split["train"] or not by_split["val"] or not by_split["test"]:
        print("Each split needs at least one session and one window.", file=sys.stderr)
        return 2
    X = {k: np.array([[r.features[f] for f in FEATURE_NAMES] for r in rs], dtype=np.float64) for k, rs in by_split.items()}
    y = {k: np.array([r.label for r in rs], dtype=np.float64) for k, rs in by_split.items()}
    mean = X["train"].mean(axis=0)
    scale = X["train"].std(axis=0)
    scale[scale < 1e-8] = 1.0
    for k in X:
        X[k] = (X[k] - mean) / scale
    w = np.zeros(len(FEATURE_NAMES), dtype=np.float64)
    b = 0.0
    pos = y["train"].sum()
    neg = len(y["train"]) - pos
    w_pos = len(y["train"]) / (2 * pos) if pos else 1.0
    w_neg = len(y["train"]) / (2 * neg) if neg else 1.0
    for _ in range(args.epochs):
        p = 1 / (1 + np.exp(-(X["train"] @ w + b)))
        sw = np.where(y["train"] == 1, w_pos, w_neg)
        grad_w = (X["train"].T @ ((p - y["train"]) * sw)) / len(y["train"]) + args.l2 * w
        grad_b = float(((p - y["train"]) * sw).mean())
        w -= args.lr * grad_w
        b -= args.lr * grad_b
    def score(Xs):
        return 1 / (1 + np.exp(-(Xs @ w + b)))
    pval = score(X["val"])
    best = None
    for thr in np.linspace(0.05, 0.95, 91):
        m = metrics(y["val"], pval, float(thr), 0.0)
        if best is None or m["f1"] > best["f1"]:
            best = m
    threshold = float(best["threshold"]) if best else 0.5
    test_negative_windows = int((y["test"] == 0).sum())
    negative_hours = test_negative_windows * args.stride / 3600.0
    test = metrics(y["test"], score(X["test"]), threshold, negative_hours)
    val = metrics(y["val"], pval, threshold, 0.0)
    report = {
        "dataset": str(data_path),
        "sessions": len(sessions),
        "splits": {k: sorted({r.session_id for r in rs}) for k, rs in by_split.items()},
        "windows": {k: len(rs) for k, rs in by_split.items()},
        "positive_windows": {k: int(y[k].sum()) for k in y},
        "features": FEATURE_NAMES,
        "validation": val,
        "test": test,
        "selection": "threshold chosen on validation F1; test used once",
        "limitations": [
            "Metrics only apply to the supplied licensed dataset and its scenes.",
            "False alarms/hour is estimated from labeled negative window duration.",
            "This workflow does not establish real-world drowning-detection safety.",
        ],
        "artifact": args.out,
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    out = {
        "kind": "logistic",
        "version": "sequence-logistic-v1",
        "features": FEATURE_NAMES,
        "mean": mean.round(8).tolist(),
        "scale": scale.round(8).tolist(),
        "weights": w.round(8).tolist(),
        "bias": round(float(b), 8),
        "threshold": threshold,
        "trained_on": {
            "sessions": len(sessions),
            "splits": report["splits"],
            "dataset": str(data_path),
            "labels": "normal|distress",
        },
        "metrics": {"validation": val, "test": test},
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
