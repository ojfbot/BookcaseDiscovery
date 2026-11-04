"""Pixel probe for F-0f's blank-card rule and NB-3's pixel discard: per box, from its warped crop. Each box of a
detect.jsonl line (spine path and, when present, the cover pass) is warped to an upright rectangle with its short side
PROBE_PX px. No text, no model.

Version 1 (F-0f): `white` (share of pixels with low saturation and high value: card stock), `edges` (share of Canny
edge pixels: lettering, art and texture) and `value` (mean brightness, 0-1).

Version 2 (NB-3, F-R3's card R3-C) adds four values measured on the crop's interior (INSET px off every side, so the
box's own boundary and its neighbours' seams stay out), all on 0-1 RGB:

- `edgeDensity`: mean RGB gradient magnitude (Sobel, root sum of squares over the channels, /8 so a unit step is 1).
  Books carry lettering and art; shelves, wood and store backgrounds are smoother (F-R3's M4 "outside", 0.77).
- `bandpass`: mean |G(sigma 1) - G(sigma 3)| of luma, a band-pass energy (F-R3's `dog`, 0.76).
- `warm`: mean red chromaticity R / (R + G + B) (F-R3's `r`: shelf undersides and wood, 0.86).
- `luma`: mean luma (0.299 R + 0.587 G + 0.114 B); low is dark (F-R3: undersides are dark, L* 0.83).

A line carries `version`: lines without one are version 1 (F-0f's probe files), so a reader asking for version-2 fields
can tell a stale cache from a missing box.

    python -I probe.py --detect detect.jsonl [--images images.jsonl] > probe.jsonl

Without --images, the photos come as JSON Lines on stdin ({"id", "image"}), as for detect.py.

One JSON line out per box: {"id": "<image>:s<i>" | "<image>:c<j>", "version", "white", "edges", "value", "edgeDensity",
"bandpass", "warm", "luma"}. stderr carries progress only, never image content.
"""

from __future__ import annotations

import argparse
import json
import sys

import cv2
import numpy as np

PROBE_VERSION = 2
PROBE_PX = 64  # short side after warping, so edge shares compare across box sizes
WHITE_S = 0.2  # saturation below this share of full scale ...
WHITE_V = 0.6  # ... and value above it: white card stock (paper under shop light)
INSET = 4  # version 2's interior: px off every side of the warped crop


def warp(img: np.ndarray, polygon: list[list[float]]) -> np.ndarray | None:
    """The box's quad warped upright, its short side PROBE_PX px (corners as detect.py orders them)."""
    p = np.float32(polygon)
    w = float(np.linalg.norm(p[1] - p[0]))
    h = float(np.linalg.norm(p[2] - p[1]))
    if min(w, h) < 4:
        return None
    s = PROBE_PX / min(w, h)
    W, H = max(4, int(round(w * s))), max(4, int(round(h * s)))
    m = cv2.getPerspectiveTransform(p, np.float32([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]))
    return cv2.warpPerspective(img, m, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)


def texture(c: np.ndarray) -> dict:
    """Version 2's values on the crop's interior (BGR uint8 in)."""
    rgb = cv2.cvtColor(c, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    g2 = sum(cv2.Sobel(rgb[..., k], cv2.CV_32F, 1, 0, ksize=3) ** 2 + cv2.Sobel(rgb[..., k], cv2.CV_32F, 0, 1, ksize=3) ** 2 for k in range(3))
    grad = np.sqrt(g2) / 8.0
    dog = np.abs(cv2.GaussianBlur(luma, (0, 0), 1) - cv2.GaussianBlur(luma, (0, 0), 3))
    r = rgb[..., 0] / (rgb.sum(axis=2) + 1e-4)
    h, w = luma.shape
    i = INSET if min(h, w) > 2 * INSET + 2 else 0
    core = (slice(i, h - i), slice(i, w - i))
    return {"edgeDensity": round(float(grad[core].mean()), 4), "bandpass": round(float(dog[core].mean()), 4),
            "warm": round(float(r[core].mean()), 4), "luma": round(float(luma[core].mean()), 4)}


def probe(img: np.ndarray, polygon: list[list[float]]) -> dict | None:
    c = warp(img, polygon)
    if c is None:
        return None
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV).astype(np.float32) / 255.0
    white = (hsv[..., 1] < WHITE_S) & (hsv[..., 2] > WHITE_V)
    edges = cv2.Canny(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), 50, 150) > 0
    return {"version": PROBE_VERSION, "white": round(float(white.mean()), 4), "edges": round(float(edges.mean()), 4),
            "value": round(float(hsv[..., 2].mean()), 4), **texture(c)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detect", required=True)
    ap.add_argument("--images")
    args = ap.parse_args()
    paths = {}
    for line in open(args.images) if args.images else sys.stdin:
        if line.strip():
            r = json.loads(line)
            paths[r["id"]] = r["image"]
    with open(args.detect) as fh:
        dets = [json.loads(l) for l in fh if l.strip()]
    for n, det in enumerate(dets, 1):
        if "error" in det or det["id"] not in paths:
            continue  # not asked for (already probed) or no detection
        img = cv2.imread(paths[det["id"]], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            raise SystemExit(f"could not decode image {n}")
        for kind, boxes in (("s", det["spines"]), ("c", det.get("covers") or [])):
            for i, b in enumerate(boxes):
                r = probe(img, b["polygon"])
                if r is not None:
                    sys.stdout.write(json.dumps({"id": f"{det['id']}:{kind}{i}", **r}) + "\n")
        print(f"probe: image {n}/{len(dets)}", file=sys.stderr)


if __name__ == "__main__":
    main()
