"""Convert the bundled demo clip into a Y4M file for Chromium's fake webcam.

Chromium's --use-file-for-fake-video-capture expects uncompressed Y4M (I420).
We downscale to keep the file bounded while retaining the two people.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


def bgr_to_i420(frame: np.ndarray) -> tuple[bytes, bytes, bytes]:
    h, w = frame.shape[:2]
    if w % 2 or h % 2:
        raise ValueError("I420 requires even dimensions")
    yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
    flat = yuv.reshape(-1)
    y = flat[: w * h].tobytes()
    u = flat[w * h : w * h + (w // 2) * (h // 2)].tobytes()
    v = flat[w * h + (w // 2) * (h // 2) :].tobytes()
    return y, u, v


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="public/video/demo.mp4")
    ap.add_argument("--out", default="test-artifacts/demo-camera.y4m")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=360)
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--max-frames", type=int, default=480)
    ap.add_argument("--loop", action="store_true")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.src)
    if not cap.isOpened():
        print(f"could not open {args.src}", file=sys.stderr)
        return 1
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(src_fps / args.fps))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with out.open("wb") as f:
        f.write(f"YUV4MPEG2 W{args.width} H{args.height} F{args.fps}:1 Ip A1:1 C420jpeg\n".encode())
        idx = 0
        while written < args.max_frames:
            ok, frame = cap.read()
            if not ok:
                if args.loop and written > 0:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    idx = 0
                    ok, frame = cap.read()
                    if not ok:
                        break
                else:
                    break
            if idx % step == 0:
                frame = cv2.resize(frame, (args.width, args.height), interpolation=cv2.INTER_AREA)
                y, u, v = bgr_to_i420(frame)
                f.write(b"FRAME\n")
                f.write(y)
                f.write(u)
                f.write(v)
                written += 1
            idx += 1
    cap.release()
    print(f"wrote {out} frames={written} src_frames={total} size={out.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
