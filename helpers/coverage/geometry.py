"""Q-2 top-edge geometry per detected spine (the owner's hypothesis: top edges are missed at frame edges and in
oblique views where a book's top face shows beside its spine).

F-0 keeps each box as the minimum-area rectangle of its mask, and the mask itself is not cached, so the box's
shape cannot show a trapezoid or a top face. This measures from pixels instead: a strip along the box's long
axis, from 20 % of its length *beyond* its top end to 30 % *inside* it, is resampled to 32 px across. Each row is
reduced to its median colour (CIE Lab) across the width, so lettering, which runs along the spine, drops out. The
row with the largest colour step between the windows just above and just below it (each 5 % of the long side) is
taken as the spine's top edge (the "top seam"): the place where the spine stops and something else begins.

- ``topSeam`` < 0: the edge lies beyond the box, so the box cuts the spine's top.
- ``topSeam`` ≈ 0: the box ends at the edge.
- ``topSeam`` > 0: the edge lies inside the box, so the box overshoots it (top face, page block or shelf above).

Units are shares of the box's long side. ``topSeamStrength`` is that row's step over the strip's median
step. ``topY`` is the top end's height in the frame (0 top, 1 bottom). Reads the same inputs as features.py
and writes one JSON line per detected spine to stdout; stderr carries progress only.

    python -I geometry.py --detect detect.jsonl --images images.jsonl > geometry.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import side_lengths  # noqa: E402

OUTSIDE = 0.20  # strip starts this share of the long side beyond the box's top end
INSIDE = 0.30  # and ends this far inside it
ACROSS = 0.8  # central share of the short side used, so neighbouring spines' edges stay out
STRIP_W = 32  # px across after resampling
WINDOW = 0.05  # share of the long side averaged on each side of a candidate seam


def top_axis(poly: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    """(top-end midpoint, unit vector from it into the box along the long axis, long side, short side)."""
    short, long_, edges01_long = side_lengths(poly)
    if edges01_long:  # short sides are 1-2 and 3-0
        a, b = (poly[1] + poly[2]) / 2, (poly[3] + poly[0]) / 2
    else:  # short sides are 0-1 and 2-3
        a, b = (poly[0] + poly[1]) / 2, (poly[2] + poly[3]) / 2
    top, bottom = (a, b) if a[1] <= b[1] else (b, a)
    u = bottom - top
    n = float(np.linalg.norm(u)) or 1.0
    return top, u / n, long_, short


def top_seam(img: np.ndarray, polygon: list[list[float]]) -> dict:
    H, W = img.shape[:2]
    poly = np.float64(polygon)
    top, u, long_, short = top_axis(poly)
    v = np.array([-u[1], u[0]])
    half = ACROSS * short / 2
    span = (OUTSIDE + INSIDE) * long_
    length = max(16, int(round(span * STRIP_W / max(2 * half, 1e-6))))
    start = top - OUTSIDE * long_ * u
    # Affine map from strip pixels (x across, y along the axis) to image pixels.
    src = np.float32([start - half * v, start + half * v, start - half * v + span * u])
    dst = np.float32([[0, 0], [STRIP_W - 1, 0], [0, length - 1]])
    m = cv2.getAffineTransform(src, dst)
    strip = cv2.warpAffine(img, m, (STRIP_W, length), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpAffine(np.full((H, W), 255, np.uint8), m, (STRIP_W, length), flags=cv2.INTER_NEAREST,
                           borderMode=cv2.BORDER_CONSTANT) > 0
    lab = cv2.cvtColor(strip, cv2.COLOR_BGR2LAB).astype(np.float32)
    rows = np.median(lab, axis=1)  # length x 3
    # Only rows wholly inside the image count: the frame border is not a spine edge.
    inside = valid.all(axis=1)
    k = max(2, int(round(WINDOW * long_ * (length - 1) / span)))
    step = np.zeros(length, np.float32)
    for r in range(k, length - k + 1):
        if inside[r - k:r + k].all():
            step[r] = float(np.linalg.norm(rows[r - k:r].mean(axis=0) - rows[r:r + k].mean(axis=0)))
    ok = step[step > 0]
    if ok.size < 4:
        return {"topSeam": None, "topSeamStrength": None, "topY": round(float(top[1] / H), 4)}
    r = int(np.argmax(step))
    seam = r / (length - 1) * (OUTSIDE + INSIDE) - OUTSIDE
    return {
        "topSeam": round(float(seam), 4),
        "topSeamStrength": round(float(step[r] / (np.median(ok) + 1e-6)), 3),
        "topY": round(float(top[1] / H), 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detect", required=True)
    ap.add_argument("--images", required=True)
    args = ap.parse_args()
    paths = {}
    with open(args.images) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                paths[r["id"]] = r["image"]
    with open(args.detect) as fh:
        dets = [json.loads(l) for l in fh if l.strip()]
    for n, det in enumerate(dets, 1):
        img = cv2.imread(paths[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            raise SystemExit(f"could not decode image {n}")
        if (img.shape[1], img.shape[0]) != (det["width"], det["height"]):
            raise SystemExit(f"image {n}: decoded size differs from the detect record")
        for i, s in enumerate(det["spines"]):
            row = {"id": f"{det['id']}:{i}", "imageId": det["id"]} | top_seam(img, s["polygon"])
            sys.stdout.write(json.dumps(row) + "\n")
        print(f"geometry: image {n}/{len(dets)}, {len(det['spines'])} spines", file=sys.stderr)


if __name__ == "__main__":
    main()
