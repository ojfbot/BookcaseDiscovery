"""NS-K frame selection: the sharpest frame in each window of an audio-free clip, written as a JPEG.

    python -I helpers/video/frames.py <clip.mov> <out-dir> [--rate 1] [--grey-long-side 640] [--quality 95]

Decodes the clip with OpenCV (the opencv-python 4.10.0.84 wheel's bundled video backend; ffmpeg itself is not used or
installed). Every frame is scored by the variance of the Laplacian of a grey copy downscaled so its long side is
`--grey-long-side` pixels. Window k holds the frames whose timestamp t satisfies k <= t * rate < k + 1; its sharpest
frame (the first one on a tie) is written to <out-dir> at native resolution, JPEG quality `--quality`, with no
metadata. A last partial window is kept like the others.

Stdout is one JSON object: the decoder, the decoded frame count, the frame size, and one row per kept frame (file name
inside <out-dir>, frame index, timestamp in seconds, sharpness, the window's median sharpness and frame count). Paths
are arguments only and are never printed. Run it with the `helpers/coverage` environment (numpy, opencv-python).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

EXTRACTOR = "helpers/video/frames.py"
EXTRACTOR_VERSION = 1


def sharpness(frame: np.ndarray, long_side: int) -> float:
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = grey.shape
    scale = long_side / max(h, w)
    if scale < 1:
        grey = cv2.resize(grey, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(grey, cv2.CV_64F, ksize=1).var())


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("clip")
    ap.add_argument("out_dir")
    ap.add_argument("--rate", type=float, default=1.0, help="windows per second (1 = one frame kept per second)")
    ap.add_argument("--grey-long-side", type=int, default=640)
    ap.add_argument("--quality", type=int, default=95)
    a = ap.parse_args(argv)
    if a.rate <= 0:
        print("frames.py: --rate must be positive", file=sys.stderr)
        return 2
    if os.path.exists(a.out_dir) and os.listdir(a.out_dir):
        print("frames.py: the output folder is not empty", file=sys.stderr)
        return 2
    os.makedirs(a.out_dir, exist_ok=True)

    cap = cv2.VideoCapture(a.clip)
    if not cap.isOpened():
        print("frames.py: OpenCV could not open the clip", file=sys.stderr)
        return 1
    backend = cap.getBackendName()
    fps = cap.get(cv2.CAP_PROP_FPS)

    rows: list[dict] = []
    decoded = 0
    size: tuple[int, int] | None = None
    window = None
    best: tuple[float, int, float, np.ndarray] | None = None  # (score, index, timestamp, frame)
    scores: list[float] = []

    def flush() -> None:
        if best is None:
            return
        score, index, ts, frame = best
        name = f"frame-{index:06d}.jpg"
        if not cv2.imwrite(os.path.join(a.out_dir, name), frame, [cv2.IMWRITE_JPEG_QUALITY, a.quality]):
            raise RuntimeError("could not write a frame")
        rows.append({
            "file": name,
            "window": window,
            "frameIndex": index,
            "timestampSeconds": round(ts, 6),
            "sharpness": round(score, 4),
            "windowMedianSharpness": round(float(np.median(scores)), 4),
            "windowFrames": len(scores),
        })

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index = decoded
        decoded += 1
        ms = cap.get(cv2.CAP_PROP_POS_MSEC)
        # POS_MSEC is the presentation time of the frame just read; fall back to index / fps when the backend gives 0.
        ts = ms / 1000.0 if (ms > 0 or index == 0) else index / fps
        if size is None:
            size = (frame.shape[1], frame.shape[0])
        k = int(ts * a.rate)
        if window is not None and k != window:
            flush()
            best, scores = None, []
        window = k
        s = sharpness(frame, a.grey_long_side)
        scores.append(s)
        if best is None or s > best[0]:
            best = (s, index, ts, frame.copy())
    flush()
    cap.release()

    if decoded == 0:
        print("frames.py: no frame decoded", file=sys.stderr)
        return 1
    json.dump({
        "extractor": {"name": EXTRACTOR, "version": EXTRACTOR_VERSION, "opencv": cv2.__version__, "backend": backend},
        "parameters": {"rate": a.rate, "greyLongSide": a.grey_long_side, "jpegQuality": a.quality, "sharpness": "variance of the Laplacian (ksize 1)"},
        "decodedFrames": decoded,
        "nominalFps": fps,
        "width": size[0],
        "height": size[1],
        "frames": rows,
    }, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
